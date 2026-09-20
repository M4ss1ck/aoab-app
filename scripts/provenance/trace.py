#!/usr/bin/env python3
"""
Traces the source artwork back to its artists, offline.

The artwork here arrived cropped and re-saved, which is why the usual services
fail on it: a crop defeats the global perceptual hashes IQDB and friends match
on, SauceNAO's API wants a paid key, and ascii2d blocks scripted requests. But
the whole corpus this art is drawn from is one Danbooru tag with under a
thousand posts, and Danbooru's post API is open. So instead of asking a search
engine about our images, this pulls the haystack down once and does the matching
locally, where a crop is an easy problem rather than a hard one.

Three steps, each cached, so a re-run costs nothing and the slow one can be
interrupted and resumed:

    python3 scripts/provenance/trace.py fetch     # post metadata (4 requests)
    python3 scripts/provenance/trace.py download  # preview images (~795)
    python3 scripts/provenance/trace.py match     # local ORB matching

`match` writes a report naming, for each source image, the best candidate and
how confident the match is. Nothing is written into the repo: the answers go
through the provenance sheet so a human confirms them first.
"""

import json
import os
import sys
import time
import urllib.request
import urllib.parse
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
SOURCE_DIR = ROOT / "src/assets/source"
CACHE = Path(os.environ.get("TRACE_CACHE", "/tmp/aoab-provenance"))
POSTS_JSON = CACHE / "posts.json"
THUMBS = CACHE / "thumbs"
REPORT = CACHE / "matches.json"
PROGRESS = CACHE / "progress.log"

TAG = os.environ.get("TRACE_TAG", "honzuki_no_gekokujou")
UA = "aoab-app-provenance/1.0 (one-off artist attribution for a fan gallery)"
# Danbooru asks callers to be gentle. This is well under any documented limit
# and the whole job still finishes in a few minutes.
DELAY = float(os.environ.get("TRACE_DELAY", "0.25"))

# Set from measurement, not taste. On this corpus the true matches scored 782 to
# 2410 inliers and every false positive scored 12 to 25 - two different pieces
# that share a character design and a palette will agree on a handful of
# features and never on hundreds. A threshold of 12 produced four wrong artists;
# anything in the wide empty gap between the two groups produces none.
MIN_INLIERS = int(os.environ.get("TRACE_MIN_INLIERS", "80"))


def log(message: str) -> None:
    """Every update goes to the terminal and to a file, so a long run can be
    followed with `tail -f` from another shell."""
    line = f"[{time.strftime('%H:%M:%S')}] {message}"
    print(line, flush=True)
    CACHE.mkdir(parents=True, exist_ok=True)
    with PROGRESS.open("a") as handle:
        handle.write(line + "\n")


def get(url: str) -> bytes:
    request = urllib.request.Request(url, headers={"User-Agent": UA})
    with urllib.request.urlopen(request, timeout=60) as response:
        return response.read()


def fetch() -> None:
    """Pulls every post for the tag. 200 per page is Danbooru's maximum."""
    CACHE.mkdir(parents=True, exist_ok=True)
    posts, page = [], 1

    while True:
        query = urllib.parse.urlencode({"tags": TAG, "limit": 200, "page": page})
        batch = json.loads(get(f"https://danbooru.donmai.us/posts.json?{query}"))
        if not batch:
            break
        posts.extend(batch)
        log(f"fetch: page {page}, {len(posts)} posts so far")
        page += 1
        time.sleep(DELAY)

    # Only posts that carry an artist tag can answer the question this tool
    # exists to answer, but the rest are kept so a match against one is still
    # reported rather than silently dropped.
    POSTS_JSON.write_text(json.dumps(posts))
    named = sum(1 for post in posts if post.get("tag_string_artist"))
    log(f"fetch: done. {len(posts)} posts, {named} with an artist tag -> {POSTS_JSON}")


def download() -> None:
    """Grabs one sample image per post. Resumable: an existing file is skipped.

    Four workers rather than one. The samples are a few hundred KB each and
    serial fetching turns a few minutes into most of an hour; four is modest
    enough to stay a polite guest and still finish while you wait.
    """
    from concurrent.futures import ThreadPoolExecutor
    import threading

    posts = json.loads(POSTS_JSON.read_text())
    THUMBS.mkdir(parents=True, exist_ok=True)

    # The sample carries enough detail for feature matching; the originals
    # would be gigabytes for no benefit.
    targets = []
    for post in posts:
        url = post.get("large_file_url") or post.get("file_url") or post.get("preview_file_url")
        if url and post.get("md5"):
            targets.append((post["id"], url))

    state = {"done": 0, "failed": 0, "seen": 0}
    lock = threading.Lock()
    started = time.time()

    def grab(target):
        post_id, url = target
        path = THUMBS / f"{post_id}.jpg"
        if path.exists() and path.stat().st_size > 0:
            outcome = "done"
        else:
            try:
                path.write_bytes(get(url))
                outcome = "done"
            except Exception as error:  # noqa: BLE001 - a dead URL must not stop the run
                outcome = "failed"
                log(f"download: {post_id} failed ({error})")
            time.sleep(DELAY)

        with lock:
            state[outcome] += 1
            state["seen"] += 1
            seen = state["seen"]
            if seen % 50 == 0 or seen == len(targets):
                elapsed = time.time() - started
                rate = seen / elapsed if elapsed else 0
                remaining = (len(targets) - seen) / rate if rate else 0
                log(
                    f"download: {seen}/{len(targets)} ({100 * seen / len(targets):.0f}%) "
                    f"| {rate:.1f}/s | eta {remaining / 60:.1f}m | {state['failed']} failed"
                )

    with ThreadPoolExecutor(max_workers=4) as pool:
        list(pool.map(grab, targets))

    log(f"download: done. {state['done']} images, {state['failed']} failed -> {THUMBS}")


def match() -> None:
    """Matches each source image against every candidate, locally.

    ORB with a ratio test and a RANSAC homography, because the relationship
    between our copy and the original is a crop plus a rescale plus JPEG
    damage - exactly what feature matching handles and what a perceptual hash
    does not.
    """
    import cv2
    import numpy as np

    posts = {post["id"]: post for post in json.loads(POSTS_JSON.read_text())}
    orb = cv2.ORB_create(nfeatures=4000)

    def features(path: Path, longest: int = 1000):
        image = cv2.imread(str(path), cv2.IMREAD_GRAYSCALE)
        if image is None:
            return None, None
        scale = longest / max(image.shape)
        if scale < 1:
            image = cv2.resize(image, None, fx=scale, fy=scale, interpolation=cv2.INTER_AREA)
        return orb.detectAndCompute(image, None)

    candidates = []
    for path in sorted(THUMBS.glob("*.jpg")):
        keypoints, descriptors = features(path)
        if descriptors is not None and len(descriptors) >= 8:
            candidates.append((int(path.stem), keypoints, descriptors))
    log(f"match: {len(candidates)} candidates indexed")

    matcher = cv2.BFMatcher(cv2.NORM_HAMMING)
    sources = sorted(
        p for p in SOURCE_DIR.iterdir() if p.suffix.lower() in {".jpg", ".jpeg", ".png", ".webp"}
    )

    report = {}
    for source in sources:
        query_keypoints, query_descriptors = features(source)
        if query_descriptors is None:
            log(f"match: {source.name} has no features, skipped")
            continue

        scored = []
        for post_id, keypoints, descriptors in candidates:
            pairs = matcher.knnMatch(query_descriptors, descriptors, k=2)
            # Lowe's ratio test: a feature that matches two places equally well
            # is noise, not evidence.
            good = [m for m, n in (p for p in pairs if len(p) == 2) if m.distance < 0.75 * n.distance]
            if len(good) < MIN_INLIERS:
                continue

            src = np.float32([query_keypoints[m.queryIdx].pt for m in good]).reshape(-1, 1, 2)
            dst = np.float32([keypoints[m.trainIdx].pt for m in good]).reshape(-1, 1, 2)
            _, mask = cv2.findHomography(src, dst, cv2.RANSAC, 5.0)
            if mask is None:
                continue

            # Inliers under a single homography mean the two images are the same
            # picture under one crop-and-scale, rather than two pictures that
            # happen to share a palette.
            inliers = int(mask.sum())
            if inliers >= MIN_INLIERS:
                scored.append((inliers, post_id))

        scored.sort(reverse=True)
        entry = {"source": source.name, "candidates": []}
        for inliers, post_id in scored[:3]:
            post = posts.get(post_id, {})
            entry["candidates"].append(
                {
                    "inliers": inliers,
                    "post": f"https://danbooru.donmai.us/posts/{post_id}",
                    "artist": post.get("tag_string_artist") or None,
                    "pixiv": (
                        f"https://www.pixiv.net/artworks/{post['pixiv_id']}"
                        if post.get("pixiv_id")
                        else None
                    ),
                    "source_url": post.get("source") or None,
                    "characters": post.get("tag_string_character") or None,
                }
            )
        report[source.stem] = entry

        best = entry["candidates"][0] if entry["candidates"] else None
        log(
            f"match: {source.name} -> "
            + (f"{best['artist']} ({best['inliers']} inliers) {best['post']}" if best else "no match")
        )

    REPORT.write_text(json.dumps(report, indent=2) + "\n")
    found = sum(1 for entry in report.values() if entry["candidates"])
    log(f"match: done. {found}/{len(report)} traced -> {REPORT}")


if __name__ == "__main__":
    command = sys.argv[1] if len(sys.argv) > 1 else "all"
    if command in ("fetch", "all"):
        fetch()
    if command in ("download", "all"):
        download()
    if command in ("match", "all"):
        match()

import tempfile
import unittest
from pathlib import Path
from unittest.mock import Mock, patch
import sys

import torch
from PIL import Image, UnidentifiedImageError
import pipeline as p


class PipelineTests(unittest.TestCase):
    def test_large_image_does_not_run_super_resolution(self):
        descriptor = Mock(scale=4)
        result = p.upscale(descriptor, Image.new('RGB', (4000, 1000)))
        self.assertEqual(result.size, (3200, 800))
        descriptor.model.assert_not_called()

    def test_inference_input_is_bounded(self):
        shapes = []
        def model(tensor):
            shapes.append(tensor.shape)
            return torch.nn.functional.interpolate(tensor, scale_factor=4)
        descriptor = Mock(scale=4, model=model)
        with patch.object(p, 'TILE', 4096):
            result = p.upscale(descriptor, Image.new('RGB', (1600, 800)))
        self.assertEqual(result.size, (3200, 1600))
        self.assertLessEqual(max(shapes[0][-2:]), 800)

    def test_avif_is_discovered(self):
        with tempfile.TemporaryDirectory() as tmp, patch.object(p, 'SOURCE_DIR', Path(tmp)):
            path = Path(tmp) / '22.avif'
            path.touch()
            self.assertEqual(p.discover(), [path])

    def test_completed_image_survives_later_interruption(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            source = root / 'source'
            source.mkdir()
            for name in ('a', 'b'):
                Image.new('RGB', (16, 16)).save(source / f'{name}.png')
            def heavy(path, *_):
                if path.stem == 'b':
                    raise KeyboardInterrupt()
                return {'width': 64, 'height': 64}
            with patch.multiple(p, ROOT=root, SOURCE_DIR=source, OUT_DIR=root / 'out',
                                MANIFEST=root / 'manifest.json', CACHE_FILE=root / 'cache.json'), \
                 patch.object(p, 'ensure_upscaler'), \
                 patch.dict(sys.modules, {'transformers': Mock()}), \
                 patch.object(p, 'run_heavy', side_effect=heavy), \
                 patch.object(sys, 'argv', ['pipeline.py']):
                with self.assertRaises(KeyboardInterrupt):
                    p.main()
                self.assertEqual(p.load_cache()['entries']['a']['heavyKey'],
                                 p.content_key(source / 'a.png', p.HEAVY_VERSION))

    def test_tiled_upscale_preserves_pixels_across_seams(self):
        import numpy as np
        pixels = np.random.default_rng(7).integers(0, 256, (29, 41, 3), dtype=np.uint8)
        descriptor = Mock(scale=4, model=lambda tensor:
                          torch.nn.functional.interpolate(tensor, scale_factor=4))
        with patch.object(p, 'TILE', 16), patch.object(p, 'TILE_PAD', 3):
            result = p.upscale(descriptor, Image.fromarray(pixels))
        expected = pixels.repeat(4, axis=0).repeat(4, axis=1)
        np.testing.assert_array_equal(np.asarray(result), expected)

    def test_atomic_cache_failure_keeps_previous_checkpoint(self):
        with tempfile.TemporaryDirectory() as tmp, patch.object(p, 'CACHE_FILE', Path(tmp) / 'cache.json'):
            p.save_cache({'entries': {'first': {}}})
            with patch.object(p.os, 'replace', side_effect=OSError('interrupted')):
                with self.assertRaises(OSError):
                    p.save_cache({'entries': {'second': {}}})
            self.assertEqual(p.load_cache(), {'entries': {'first': {}}})

    def test_successful_rerun_loads_no_models_and_missing_edge_is_rebuilt(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            source = root / 'source'
            source.mkdir()
            Image.new('RGBA', (16, 16), (255, 128, 64, 200)).save(source / 'myne.png')
            descriptor = Mock(scale=4, model=lambda tensor:
                              torch.nn.functional.interpolate(tensor, scale_factor=4))
            depth = Mock(return_value={'depth': Image.new('L', (16, 16), 128)})
            transformers = Mock()
            transformers.pipeline.return_value = depth
            with patch.multiple(p, ROOT=root, SOURCE_DIR=source, OUT_DIR=root / 'out',
                                MANIFEST=root / 'manifest.json', CACHE_FILE=root / 'cache.json'), \
                 patch.object(p, 'ensure_upscaler', return_value=descriptor) as load, \
                 patch.dict(sys.modules, {'transformers': transformers}), \
                 patch.object(sys, 'argv', ['pipeline.py']):
                self.assertEqual(p.main(), 0)
                self.assertEqual(p.main(), 0)
                self.assertEqual(load.call_count, 1)
                self.assertEqual(depth.call_count, 1)
                with Image.open(root / 'out/myne.webp') as image:
                    self.assertEqual(image.mode, 'RGBA')
                (root / 'out/myne.edge.webp').unlink()
                self.assertEqual(p.main(), 0)
                self.assertEqual(load.call_count, 2)

    def test_invalid_input_fails_before_model_loading(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            (root / 'bad.jpg').write_bytes(b'not an image')
            with patch.multiple(p, SOURCE_DIR=root, OUT_DIR=root / 'out', MANIFEST=root / 'manifest.json'), \
                 patch.object(p, 'ensure_upscaler') as load:
                with self.assertRaises(UnidentifiedImageError):
                    p.main()
                load.assert_not_called()

    def test_duplicate_ids_fail_before_model_loading(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            for extension in ('png', 'jpg'):
                Image.new('RGB', (8, 8)).save(root / f'same.{extension}')
            with patch.multiple(p, SOURCE_DIR=root, OUT_DIR=root / 'out', MANIFEST=root / 'manifest.json'), \
                 patch.object(p, 'ensure_upscaler') as load:
                with self.assertRaisesRegex(SystemExit, 'duplicate asset id: same'):
                    p.main()
                load.assert_not_called()


if __name__ == '__main__':
    unittest.main()

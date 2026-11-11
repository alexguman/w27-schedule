"""Runs the JavaScript unit tests for src/requirements.js (tests/requirements.test.js) with Node.

Uses Node's built-in test runner, so no npm packages are needed. Skipped when Node is not installed.
"""

import shutil
import subprocess

import pytest
from build import ROOT

NODE = shutil.which("node")


@pytest.mark.skipif(NODE is None, reason="Node.js is not installed")
def test_requirements_engine_js():
    result = subprocess.run(
        [NODE, "--test", str(ROOT / "tests" / "requirements.test.js")],
        cwd=ROOT,
        capture_output=True,
        text=True,
        timeout=120,
    )
    assert result.returncode == 0, result.stdout + result.stderr

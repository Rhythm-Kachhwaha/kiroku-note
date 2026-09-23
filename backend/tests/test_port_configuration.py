"""Tests for Kiroku backend host and port configuration."""
import os
import sys
import unittest
from unittest.mock import patch, MagicMock

# Ensure project root and backend dir are in sys.path
TEST_DIR = os.path.dirname(os.path.abspath(__file__))
BACKEND_DIR = os.path.dirname(TEST_DIR)
ROOT_DIR = os.path.dirname(BACKEND_DIR)

for path in (ROOT_DIR, BACKEND_DIR):
    if path not in sys.path:
        sys.path.insert(0, path)

from app.config import DEFAULT_KIROKU_HOST, DEFAULT_KIROKU_PORT, resolve_port
import run_backend


class TestPortConfiguration(unittest.TestCase):
    def test_default_port_is_21828(self):
        """Default port must be 21828 when no environment variables are set."""
        self.assertEqual(DEFAULT_KIROKU_PORT, 21828)
        self.assertEqual(DEFAULT_KIROKU_HOST, "127.0.0.1")
        self.assertEqual(resolve_port({}), 21828)

    def test_kiroku_port_overrides_default(self):
        """KIROKU_PORT environment variable must override default port."""
        env = {"KIROKU_PORT": "21829"}
        self.assertEqual(resolve_port(env), 21829)

    def test_port_fallback(self):
        """PORT environment variable must work as fallback when KIROKU_PORT is absent."""
        env = {"PORT": "21830"}
        self.assertEqual(resolve_port(env), 21830)

    def test_kiroku_port_precedence_over_port(self):
        """KIROKU_PORT must take precedence over PORT if both are set."""
        env = {"KIROKU_PORT": "21829", "PORT": "21830"}
        self.assertEqual(resolve_port(env), 21829)

    def test_empty_env_vars_fallback_to_default(self):
        """Empty or whitespace environment variable strings must fall back to default."""
        env = {"KIROKU_PORT": "   ", "PORT": ""}
        self.assertEqual(resolve_port(env), 21828)

    def test_invalid_non_numeric_port_rejected(self):
        """Non-numeric port string must raise ValueError with clear message."""
        with self.assertRaises(ValueError) as ctx:
            resolve_port({"KIROKU_PORT": "invalid_port"})
        self.assertIn("Invalid port value: 'invalid_port'", str(ctx.exception))
        self.assertIn("between 1 and 65535", str(ctx.exception))

    def test_port_out_of_range_zero(self):
        """Port 0 must be rejected."""
        with self.assertRaises(ValueError) as ctx:
            resolve_port({"KIROKU_PORT": "0"})
        self.assertIn("Port out of range: 0", str(ctx.exception))

    def test_port_out_of_range_negative(self):
        """Negative port numbers must be rejected."""
        with self.assertRaises(ValueError) as ctx:
            resolve_port({"KIROKU_PORT": "-10"})
        self.assertIn("Port out of range: -10", str(ctx.exception))

    def test_port_out_of_range_high(self):
        """Port greater than 65535 must be rejected."""
        with self.assertRaises(ValueError) as ctx:
            resolve_port({"KIROKU_PORT": "70000"})
        self.assertIn("Port out of range: 70000", str(ctx.exception))

    def test_valid_edge_ports(self):
        """Valid edge ports (1 and 65535) must be accepted."""
        self.assertEqual(resolve_port({"KIROKU_PORT": "1"}), 1)
        self.assertEqual(resolve_port({"KIROKU_PORT": "65535"}), 65535)

    @patch("uvicorn.run")
    def test_start_server_invokes_uvicorn_with_configured_port(self, mock_uvicorn):
        """start_server must call uvicorn.run with resolved port and host 127.0.0.1."""
        with patch.dict(os.environ, {"KIROKU_PORT": "21828"}, clear=True):
            with patch.object(run_backend, "check_port_available"):
                run_backend.start_server()
            mock_uvicorn.assert_called_once_with(
                "app.main:app",
                host="127.0.0.1",
                port=21828,
                app_dir=run_backend.BACKEND_DIR,
                reload=False,
            )

    @patch("uvicorn.run", side_effect=OSError("[WinError 10048] Only one usage of each socket address"))
    def test_start_server_catches_occupied_port_error(self, mock_uvicorn):
        """When socket is occupied, start_server must print actionable guidance and exit cleanly."""
        with patch.dict(os.environ, {"KIROKU_PORT": "21828"}, clear=True):
            with patch("sys.stderr"):
                with self.assertRaises(SystemExit) as ctx:
                    run_backend.start_server()
                self.assertEqual(ctx.exception.code, 1)


if __name__ == "__main__":
    unittest.main()

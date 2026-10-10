"""The server stops by itself when the app that started it is gone."""

import json
import subprocess
import sys

import pytest


def start(tmp_path, *extra):
    return subprocess.Popen(
        [
            sys.executable,
            "-m",
            "photo3d_engine",
            "--engine",
            "dummy",
            "--data-dir",
            str(tmp_path),
            *extra,
        ],
        stdin=subprocess.PIPE,
        stdout=subprocess.PIPE,
        stderr=subprocess.DEVNULL,
        text=True,
    )


def test_stops_when_stdin_closes(tmp_path):
    server = start(tmp_path, "--exit-with-parent")
    try:
        info = json.loads(server.stdout.readline())
        assert info["port"] > 0

        server.stdin.close()  # what happens when the app dies

        # it ended by itself (uvicorn reports a stop by SIGINT as exit code -2, like Ctrl+C)
        assert server.wait(timeout=20) in (0, -2)
    finally:
        if server.poll() is None:
            server.kill()


def test_keeps_running_without_the_option(tmp_path):
    server = start(tmp_path)
    try:
        json.loads(server.stdout.readline())
        server.stdin.close()
        with pytest.raises(subprocess.TimeoutExpired):
            server.wait(timeout=3)
    finally:
        server.kill()
        server.wait()


def test_stops_on_sigterm_while_the_app_is_connected(tmp_path):
    """A connected /ws client that sends nothing must not keep the server from stopping."""
    from websockets.sync.client import connect

    server = start(tmp_path)
    try:
        info = json.loads(server.stdout.readline())
        url = f"ws://127.0.0.1:{info['port']}/ws?token={info['token']}"
        with connect(url):
            server.terminate()  # what the app does when it quits
            assert server.wait(timeout=15) in (0, -15)
    finally:
        if server.poll() is None:
            server.kill()

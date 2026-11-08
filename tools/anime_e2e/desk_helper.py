import asyncio
import json
import threading
import websockets

class DesktopClient:
    """Simulates desktop LinkClient & LinkStore connected via real WebSocket."""
    def __init__(self, port=21828, token="desktop-test-token"):
        self.port = port
        self.token = token
        self.ws_url = f"ws://127.0.0.1:{port}/api/link/ws"
        self.messages = []
        self.session = None
        self.connected = False
        self._loop = None
        self._thread = None
        self._ws = None

    def start(self):
        self._loop = asyncio.new_event_loop()
        self._thread = threading.Thread(target=self._run, daemon=True)
        self._thread.start()

    def _run(self):
        asyncio.set_event_loop(self._loop)
        self._loop.run_until_complete(self._connect_and_listen())

    async def _connect_and_listen(self):
        try:
            async with websockets.connect(self.ws_url) as ws:
                self._ws = ws
                # Send hello as desk
                await ws.send(json.dumps({
                    "v": 1,
                    "id": "desk-hello-1",
                    "ts": 1730750000000,
                    "type": "hello",
                    "src": "desk",
                    "payload": {
                        "role": "desk",
                        "token": self.token,
                        "client": "desk-test-helper"
                    }
                }))
                self.connected = True
                async for raw in ws:
                    try:
                        msg = json.loads(raw)
                        self.messages.append(msg)
                        mtype = msg.get("type")
                        if mtype == "video.attach":
                            self.session = msg.get("session")
                        elif mtype == "video.detach":
                            self.session = None
                    except Exception:
                        pass
        except Exception:
            self.connected = False

    def send_cmd(self, cmd_dict):
        if not self._ws or not self._loop:
            return
        asyncio.run_coroutine_threadsafe(
            self._ws.send(json.dumps(cmd_dict)),
            self._loop
        )

    def stop(self):
        if self._loop and self._loop.is_running():
            async def _cleanup():
                if self._ws:
                    try:
                        await self._ws.close()
                    except Exception:
                        pass
                self._loop.stop()
            asyncio.run_coroutine_threadsafe(_cleanup(), self._loop)

import http.server
import socketserver
import threading
from pathlib import Path

FIXTURES_DIR = Path(__file__).parent / "fixtures"

HTML_PAGES = {
    "/plain.html": """<!DOCTYPE html>
<html>
<head><title>Plain Video Fixture</title></head>
<body>
  <h1>Plain Video</h1>
  <video id="player" controls width="640" height="360" src="/test.webm"></video>
</body>
</html>""",

    "/iframe_parent.html": """<!DOCTYPE html>
<html>
<head><title>Iframe Video Fixture</title></head>
<body>
  <h1>Iframe Video</h1>
  <iframe id="child-frame" src="/plain.html" width="700" height="400"></iframe>
</body>
</html>""",

    "/shadow.html": """<!DOCTYPE html>
<html>
<head><title>Shadow DOM Video Fixture</title></head>
<body>
  <h1>Shadow DOM Video</h1>
  <div id="host"></div>
  <script>
    const host = document.getElementById('host');
    const root = host.attachShadow({mode: 'open'});
    const vid = document.createElement('video');
    vid.id = 'shadow-player';
    vid.controls = true;
    vid.width = 640;
    vid.height = 360;
    vid.src = '/test.webm';
    root.appendChild(vid);
  </script>
</body>
</html>""",

    "/late.html": """<!DOCTYPE html>
<html>
<head><title>Late Video Fixture</title></head>
<body>
  <h1>Late Video</h1>
  <button id="add-video-btn">Load Video</button>
  <div id="video-container"></div>
  <script>
    document.getElementById('add-video-btn').addEventListener('click', () => {
      const vid = document.createElement('video');
      vid.id = 'late-player';
      vid.controls = true;
      vid.width = 640;
      vid.height = 360;
      vid.src = '/test.webm';
      document.getElementById('video-container').appendChild(vid);
    });
  </script>
</body>
</html>""",

    "/spa.html": """<!DOCTYPE html>
<html>
<head><title>SPA Video Fixture - Ep 1</title></head>
<body>
  <h1 id="title">Episode 1</h1>
  <button id="next-ep-btn">Next Episode</button>
  <div id="container">
    <video id="ep1-player" controls width="640" height="360" src="/test.webm"></video>
  </div>
  <script>
    document.getElementById('next-ep-btn').addEventListener('click', () => {
      document.getElementById('title').textContent = 'Episode 2';
      const container = document.getElementById('container');
      container.innerHTML = '<video id="ep2-player" controls width="640" height="360" src="/test.webm"></video>';
    });
  </script>
</body>
</html>""",

    "/anime.html": """<!DOCTYPE html>
<html>
<head>
  <title>Watch K-ON! Episode 1 Online Free - HiAnime</title>
  <style>
    body { margin: 0; background: #0e0e10; font-family: sans-serif; color: #fff; }
    .player-section { display: flex; flex-direction: column; align-items: center; padding: 20px; }
    .jwplayer { position: relative; width: 640px; height: 360px; background: #000; border-radius: 8px; overflow: hidden; }
    .jw-wrapper { position: absolute; top: 0; left: 0; width: 100%; height: 100%; }
    .jw-media { position: absolute; top: 0; left: 0; width: 100%; height: 100%; }
    video { width: 100%; height: 100%; object-fit: contain; }
  </style>
</head>
<body>
  <div class="player-section">
    <h1 id="anime-title">K-ON! - Ep 1: Disband the Club!</h1>
    <div class="jwplayer jw-reset" id="player">
      <div class="jw-wrapper jw-reset">
        <div class="jw-media jw-reset">
          <video id="player-video" controls width="640" height="360" playsinline autoplay muted src="/test.webm" crossorigin="anonymous" loop></video>
        </div>
      </div>
    </div>
  </div>
  <script>
    const canvas = document.createElement('canvas');
    canvas.width = 640;
    canvas.height = 360;
    const ctx = canvas.getContext('2d');
    let frame = 0;

    function draw() {
      frame++;
      const hue = (frame * 2) % 360;
      const grad = ctx.createLinearGradient(0, 0, 640, 360);
      grad.addColorStop(0, 'hsl(' + hue + ', 80%, 45%)');
      grad.addColorStop(1, 'hsl(' + ((hue + 60) % 360) + ', 85%, 25%)');
      ctx.fillStyle = grad;
      ctx.fillRect(0, 0, 640, 360);

      ctx.fillStyle = '#ffffff';
      ctx.beginPath();
      ctx.arc(320 + Math.sin(frame * 0.05) * 50, 180 + Math.cos(frame * 0.05) * 30, 60, 0, Math.PI * 2);
      ctx.fill();

      ctx.fillStyle = '#fef08a';
      ctx.font = 'bold 28px sans-serif';
      ctx.fillText('けいおん! Episode 01', 50, 60);

      ctx.fillStyle = '#ffffff';
      ctx.font = '20px sans-serif';
      const curT = vid ? vid.currentTime : 0;
      ctx.fillText('Time: ' + curT.toFixed(2) + 's', 50, 320);

      requestAnimationFrame(draw);
    }
    draw();

    const vid = document.getElementById('player-video');
    const stream = canvas.captureStream(30);
    vid.srcObject = stream;
    vid.play().catch(() => {});
  </script>
</body>
</html>"""
}

class FixtureHandler(http.server.SimpleHTTPRequestHandler):
    def do_GET(self):
        if self.path in HTML_PAGES:
            content = HTML_PAGES[self.path].encode("utf-8")
            self.send_response(200)
            self.send_header("Content-Type", "text/html; charset=utf-8")
            self.send_header("Content-Length", str(len(content)))
            self.end_headers()
            self.wfile.write(content)
            return

        if self.path == "/test.webm":
            filepath = FIXTURES_DIR / "test.webm"
            if filepath.exists():
                data = filepath.read_bytes()
                self.send_response(200)
                self.send_header("Content-Type", "video/webm")
                self.send_header("Access-Control-Allow-Origin", "*")
                self.send_header("Content-Length", str(len(data)))
                self.end_headers()
                self.wfile.write(data)
                return

        if self.path == "/test.srt":
            filepath = FIXTURES_DIR / "test.srt"
            if filepath.exists():
                data = filepath.read_bytes()
                self.send_response(200)
                self.send_header("Content-Type", "text/plain; charset=utf-8")
                self.send_header("Content-Length", str(len(data)))
                self.end_headers()
                self.wfile.write(data)
                return

        self.send_response(404)
        self.end_headers()

    def log_message(self, format, *args):
        pass  # Quiet logs

class FixtureServer:
    def __init__(self, port=8989):
        self.port = port
        self.server = None
        self.thread = None

    def start(self):
        self.server = socketserver.TCPServer(("127.0.0.1", self.port), FixtureHandler)
        self.server.allow_reuse_address = True
        self.thread = threading.Thread(target=self.server.serve_forever, daemon=True)
        self.thread.start()

    def stop(self):
        if self.server:
            self.server.shutdown()
            self.server.server_close()


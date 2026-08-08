"""Smoke test do extrator — gate da Fase 2 (sucesso >= 80%).

Uso (dentro do container, apontando para si mesmo):
    docker exec radio-extractor python smoke_test.py
Ou localmente (se o container estiver publicado na 8000):
    python smoke_test.py
"""
import json
import time
import urllib.error
import urllib.request

BASE = "http://127.0.0.1:8000/extract"

VIDEOS = [
    "https://www.youtube.com/watch?v=dQw4w9WgXcQ",   # Rick Astley
    "https://www.youtube.com/watch?v=FTQbiNvZqaY",   # Toto - Africa
    "https://www.youtube.com/watch?v=fJ9rUzIMcZQ",   # Queen - Bohemian Rhapsody
    "https://www.youtube.com/watch?v=Zi_XLOBDo_Y",   # MJ - Billie Jean
    "https://www.youtube.com/watch?v=hTWKbfoikeg",   # Nirvana - Smells Like Teen Spirit
    "https://www.youtube.com/watch?v=dvgZkm1xWPE",   # Coldplay - Viva La Vida
    "https://www.youtube.com/watch?v=BtN_goyGO-o",   # Survivor - Eye of the Tiger
    "https://www.youtube.com/watch?v=VcjzHMhBtfQ",   # Journey - Don't Stop Believin'
    "https://www.youtube.com/watch?v=6Ejga4kJUts",   # Cranberries - Zombie
    "https://www.youtube.com/watch?v=xFrGuyw1V8s",   # ABBA - Dancing Queen
    "https://www.youtube.com/watch?v=8SbUC-UaAxE",   # GNR - November Rain
    "https://www.youtube.com/watch?v=_Yhyp-_hX2s",   # Eminem - Lose Yourself
    "https://www.youtube.com/watch?v=kXYiU_JCYtU",   # Linkin Park - Numb
    "https://www.youtube.com/watch?v=YQHsXMglC9A",   # Adele - Hello
    "https://www.youtube.com/watch?v=JGwWNGJdvx8",   # Ed Sheeran - Shape of You
    "https://www.youtube.com/watch?v=kJQP7kiw5Fk",   # Despacito
    "https://www.youtube.com/watch?v=pRpeEdMmmQ0",   # Shakira - Waka Waka
    "https://www.youtube.com/watch?v=04854XqcfCY",   # Queen - We Are The Champions
    "https://www.youtube.com/watch?v=bnVUHWCynig",   # Beyonce - Halo
    "https://youtu.be/LjhCEhWiKXk",                  # Bruno Mars - Just the Way You Are
]


def post(url: str):
    data = json.dumps({"url": url}).encode()
    req = urllib.request.Request(BASE, data=data, headers={"Content-Type": "application/json"})
    start = time.time()
    try:
        with urllib.request.urlopen(req, timeout=45) as resp:
            body = json.loads(resp.read())
            return True, time.time() - start, body
    except urllib.error.HTTPError as e:
        detail = e.read().decode()[:300]
        return False, time.time() - start, {"http": e.code, "body": detail}
    except Exception as e:  # noqa: BLE001
        return False, time.time() - start, {"err": str(e)}


def main():
    total = len(VIDEOS)
    ok_count = 0
    latencies = []
    print(f"{'#':>2} {'OK':<4} {'lat(s)':<7} {'ext':<5} {'fonte':<7} detalhe")
    print("-" * 72)
    for i, url in enumerate(VIDEOS, 1):
        ok, elapsed, body = post(url)
        latencies.append(elapsed)
        if ok and not body.get("fallback"):
            ok_count += 1
            ext = body.get("audio_ext") or body.get("audio_url", "")[-4:]
            source = body.get("source", "?")
            titulo = (body.get("titulo") or "")[:40]
            print(f"{i:>2}  SIM  {elapsed:6.1f}  {ext:<5} {source:<7} {titulo}")
        elif ok:
            print(f"{i:>2}  DEM  {elapsed:6.1f}  {'':<5} demo    fallback demo")
        else:
            detail = body.get("body") or body.get("err") or ""
            code = "?"
            try:
                j = json.loads(detail)
                code = j.get("error", {}).get("code", "?")
            except Exception:  # noqa: BLE001
                pass
            print(f"{i:>2}  NAO  {elapsed:6.1f}  {'':<5} {code:<7} {detail[:60]}")

    rate = ok_count / total * 100
    avg_lat = sum(latencies) / len(latencies)
    first_lat = latencies[0] if latencies else 0
    print("-" * 72)
    print(f"Sucesso (real, sem fallback): {ok_count}/{total} = {rate:.0f}%")
    print(f"Latencia media: {avg_lat:.1f}s | 1a resolucao: {first_lat:.1f}s")
    print("GATE: ", "APROVADO" if rate >= 80 else "REPROVADO")


if __name__ == "__main__":
    main()

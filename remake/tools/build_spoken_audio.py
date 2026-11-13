"""Render the fan edition's Korean speech in advance with Supertonic 3.

With FFmpeg, Python 3.12 and `pip install supertonic==1.3.1`, run this script.
It loads supertone-oss-archive/supertonic-3 revision aafc6e32416a594460b32413efc49d7fe4ce6d46.
An already downloaded model can be supplied with --model-dir for an offline run.
The site ships only generated audio, without the inference software or model.
Model / output terms: https://huggingface.co/supertone-oss-archive/supertonic-3/blob/main/LICENSE
"""
import argparse
import hashlib
import json
from pathlib import Path
import subprocess

import numpy as np
from supertonic import TTS


ROOT = Path(__file__).resolve().parents[1]
MODEL_REV = 'aafc6e32416a594460b32413efc49d7fe4ce6d46'


def performance(key):
    """Preset and delivery pace for each speaker's role."""
    if key.startswith('MG_'):
        group = key.split('_')[1]
        return 'M4', {'00': 1.02, '01': 1.05, '02': 1.04, '03': 1.00, '04': .97}[group]
    if key.startswith('POL') or key in ('FIELD_ARREST', 'FIELD_TICKET'):
        return 'M3', 1.035
    if key.startswith('MDVC') or key in ('FIELD_MEDIC', 'FIELD_HOSPITAL', 'FIELD_AMBULANCE', 'FIELD_TRIAGE', 'FIELD_DOCTOR'):
        return 'F3', 1.03
    if key.startswith('DJ'):
        # Each station has one regular host rather than a new voice every track.
        number = int(key[2:])
        if number > 12:
            return 'F3', .96
        return {1: ('M5', .97), 2: ('F2', 1.02), 0: ('M1', 1.03)}[number % 3]
    if key.startswith('AD'):
        return 'F4', 1.01
    if key.startswith('FIELD'):
        return ('F2', 1.08) if key in ('FIELD_HELP', 'FIELD_RESCUE', 'FIELD_SAFE', 'FIELD_WITNESS', 'FIELD_HARNESS', 'FIELD_VIP_BOARD', 'FIELD_VIP_EXIT') else ('M1', .98)
    return 'F5', 1.01


def master(key, samples, sample_rate):
    samples = np.asarray(samples, dtype=float).flatten()
    active = np.flatnonzero(np.abs(samples) > 0.0025)
    if not active.size:
        raise ValueError(f'Silent synthesis for {key}')
    margin = round(0.055 * sample_rate)
    samples = samples[max(0, active[0] - margin):active[-1] + round(.11 * sample_rate) + 1]

    # Only the aircraft loudspeaker has baked-in horn coloration. Radio
    # filtering and transmission gates are applied by the runtime audio bus.
    horn = key.startswith('MG_')
    padded = np.pad(samples, (margin, margin))
    frequencies = np.fft.rfftfreq(padded.size, 1 / sample_rate)
    bass, treble = (230, 4750) if horn else (55, 9250)
    transfer = (frequencies ** 2 / (bass ** 2 + frequencies ** 2)
                / np.sqrt(1 + (frequencies / treble) ** 8))
    samples = np.fft.irfft(np.fft.rfft(padded) * transfer, padded.size)
    if horn:
        samples = np.tanh(1.48 * samples)
        delay = round(0.075 * sample_rate)
        samples = np.pad(samples, (0, delay)) + 0.105 * np.pad(samples, (delay, 0))

    if sample_rate == 44100:
        samples = samples[::2]
        sample_rate //= 2
    peak = np.max(np.abs(samples))
    if peak < 0.01:
        raise ValueError(f'Inaudible synthesis for {key}')
    # Raise quiet sentences without clipping the strong consonants.
    strong = np.percentile(np.abs(samples), 95)
    samples *= min(0.83 / peak, 0.31 / max(0.001, strong))
    fade = min(round(0.005 * sample_rate), len(samples) // 2)
    samples[:fade] *= np.linspace(0, 1, fade)
    samples[-fade:] *= np.linspace(1, 0, fade)
    return sample_rate, np.round(samples * 32767).astype('<i2')


def load_scripts(args):
    if args.dispatch:
        module = (ROOT / 'src/dispatch-phrases.js').as_uri()
        code = f"import {{dispatchPhrases}} from {json.dumps(module)}; console.log(JSON.stringify(Object.fromEntries(dispatchPhrases)));"
        output = subprocess.check_output(['node', '--input-type=module', '-e', code])
        return json.loads(output.decode('utf-8'))
    if args.scripts:
        return json.loads(args.scripts.read_text(encoding='utf-8-sig'))
    manifest = (ROOT / 'src/spoken-lines.js').read_text(encoding='utf-8')
    return json.loads(manifest.split('export default ', 1)[1].strip().removesuffix(';'))


def run():
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument('--model-dir', type=Path)
    parser.add_argument('--ffmpeg', default='ffmpeg')
    parser.add_argument('--only', nargs='+', help='render individual sound IDs')
    inputs = parser.add_mutually_exclusive_group()
    inputs.add_argument('--dispatch', action='store_true', help='render complete dispatch transmissions')
    inputs.add_argument('--scripts', type=Path, help='use a JSON file mapping clip IDs to Korean lines')
    parser.add_argument('--output', type=Path, help='target directory')
    parser.add_argument('--bitrate', help='MP3 bitrate (default 64k, or 40k for dispatch messages)')
    args = parser.parse_args()
    model_dir = args.model_dir
    if not model_dir:
        from huggingface_hub import snapshot_download
        model_dir = snapshot_download(repo_id='supertone-oss-archive/supertonic-3', revision=MODEL_REV,
                                      allow_patterns=['*.json', '*.onnx', 'LICENSE'])
    engine = TTS(model='supertonic-3', model_dir=str(model_dir), auto_download=False,
                 intra_op_num_threads=3, inter_op_num_threads=1)
    lines = load_scripts(args)
    destination = args.output or ROOT / 'art/audio' / ('dispatch' if args.dispatch else 'synth')
    destination.mkdir(parents=True, exist_ok=True)
    bitrate = args.bitrate or ('40k' if args.dispatch else '64k')
    voices = {}
    for key in (args.only if args.only else lines):
        if Path(key).name != key or key in ('.', '..'):
            raise ValueError(f'Invalid audio ID {key}')
        voice, pace = performance(key)
        if voice not in voices:
            voices[voice] = engine.get_voice_style(voice)
        seed = int.from_bytes(hashlib.sha256(key.encode()).digest()[:4], 'little')
        np.random.seed(seed)
        speech, _ = engine.synthesize(lines[key], voice_style=voices[voice], lang='ko',
                                      speed=pace, total_steps=10, silence_duration=0.17)
        rate, pcm = master(key, speech, engine.sample_rate)
        temporary = destination / (key + '.part')
        subprocess.run([args.ffmpeg, '-hide_banner', '-loglevel', 'error', '-nostdin', '-y',
                        '-f', 's16le', '-ar', str(rate), '-ac', '1', '-i', 'pipe:0',
                        '-codec:a', 'libmp3lame', '-b:a', bitrate, '-id3v2_version', '0',
                        '-f', 'mp3', str(temporary)], input=pcm.tobytes(), check=True)
        temporary.replace(destination / (key + '.mp3'))
        print(f'{key}  {len(pcm) / rate:.2f}s', flush=True)


if __name__ == '__main__':
    run()

"""Render the game's original, sample-free sound effects to mono PCM WAV files."""

from pathlib import Path
import wave

import numpy as np


RATE = 32_000
TAU = 2 * np.pi
OUT = Path(__file__).resolve().parents[1] / "art" / "audio" / "synth"


def timeline(seconds):
    return np.arange(round(RATE * seconds)) / RATE


def noise(t, rng, low, high):
    """Circular band-limited noise. There is no filter state at the rotor seam."""
    frequencies = np.fft.rfftfreq(len(t), 1 / RATE)
    rolloff = (1 - np.exp(-(frequencies / low) ** 4)) * np.exp(-(frequencies / high) ** 4)
    spectrum = np.fft.rfft(rng.normal(size=len(t))) * rolloff
    signal = np.fft.irfft(spectrum, n=len(t))
    return signal / np.sqrt(np.mean(signal ** 2))


def smooth(x):
    x = np.clip(x, 0, 1)
    return x * x * (3 - 2 * x)


def tone(hz):
    return np.sin(TAU * np.cumsum(hz) / RATE)


def ring(t, start, pitch, decay, partials):
    """Struck resonator, with a short attack and faster decay for upper modes."""
    elapsed = np.maximum(0, t - start)
    sound = np.zeros_like(t)
    for ratio, weight in partials:
        sound += weight * np.exp(-elapsed * decay * np.sqrt(ratio)) * np.sin(TAU * pitch * ratio * elapsed)
    return smooth(elapsed / .002) * sound


def rotor(rng):
    t = timeline(4)
    # Every oscillator and modulation completes a whole number of cycles here.
    phase = TAU * 16 * t + .13 * np.sin(TAU * .75 * t) + .07 * np.sin(TAU * 1.25 * t)
    blade = (.5 + .5 * np.cos(phase)) ** 4
    pair = .87 + .13 * np.sin(TAU * 8 * t)
    thump = .28 * np.sin(phase * 3) + .21 * np.sin(phase * 5 + .3) + .12 * np.sin(phase * 7)
    air = .27 * noise(t, rng, 70, 550) + .095 * noise(t, rng, 500, 2300)
    tail = .12 * np.sin(TAU * 94 * t + .32 * np.sin(phase)) + .044 * np.sin(TAU * 188 * t)
    motor = .055 * np.sin(TAU * 269 * t + .38 * np.sin(TAU * .5 * t))
    return pair * (.19 + .81 * blade) * (thump + air) + tail + motor


def start_engine(rng):
    t = timeline(2.65)
    spin = smooth((t - .14) / 1.85)
    starter = .16 * tone(275 + 485 * smooth(t / 1.1) + 6 * np.sin(TAU * 9 * t))
    starter *= smooth(t / .04) * (1 - smooth((t - .8) / .78))
    phase = TAU * np.cumsum(3 + 13 * spin) / RATE
    pulse = (.5 + .5 * np.cos(phase)) ** 3
    exhaust = (.35 * noise(t, rng, 85, 640) + .44 * np.sin(4 * phase)) * (.15 + .85 * pulse)
    motor = .17 * tone(39 + 148 * spin) + .055 * tone(146 + 239 * spin)
    return starter + (motor + exhaust) * smooth((t - .22) / .6) * (1 - smooth((t - 1.67) / .97))


def blip(_rng):
    t = timeline(.16)
    envelope = smooth(t / .008) * np.exp(-19 * t)
    return envelope * (tone(730 + 142 * smooth(t / .055)) + .21 * tone(1460 + 284 * smooth(t / .055)))


def reward(_rng):
    t = timeline(.85)
    partials = [(1, .9), (2.67, .45), (4.06, .19)]
    return (ring(t, 0, 815, 9, partials) + .68 * ring(t, .075, 1136, 7.4, partials)
            + .79 * ring(t, .16, 1492, 6.8, partials))


def brakes(rng):
    t = timeline(1.34)
    envelope = smooth(t / .10) * (1 - smooth((t - .85) / .47))
    pitch = 640 + 584 * np.sin(np.pi * t / 1.50) - 230 * t + 20 * np.sin(TAU * 38 * t)
    skid = .50 * tone(pitch) + .22 * tone(2.012 * pitch) + .10 * tone(3.14 * pitch)
    grip = .81 + .19 * np.sin(TAU * (13 * t + 2.8 * t * t))
    return envelope * (grip * skid + .16 * noise(t, rng, 720, 3600) + .10 * noise(t, rng, 80, 620))


def siren(_rng):
    t = timeline(3.05)
    sweep = .5 - .5 * np.cos(TAU * t / 1.47)
    hz = 485 + 432 * sweep
    return (.54 * tone(hz) + .27 * tone(2 * hz) + .15 * tone(3 * hz) + .07 * tone(5 * hz)
            ) * smooth(t / .065) * (1 - smooth((t - 2.82) / .22))


def ignition(rng):
    t = timeline(1.15)
    flame = smooth(t / .055) * np.exp(-2.8 * t)
    strike = np.exp(-32 * t) * noise(t, rng, 1000, 7200)
    return (.47 * noise(t, rng, 64, 390) + .27 * noise(t, rng, 480, 2000)) * flame + .22 * strike


def water(rng):
    t = timeline(1.8)
    jet = smooth(t / .11) * (1 - smooth((t - .70) / .68))
    roar = (.34 * noise(t, rng, 65, 530) + .18 * noise(t, rng, 540, 3200)) * jet
    spray = .16 * noise(t, rng, 1500, 5250) * smooth(t / .28) * (1 - smooth((t - 1.02) / .75))
    for delay in rng.uniform(.74, 1.65, 22):
        roar += .08 * ring(t, delay, rng.uniform(500, 1660), rng.uniform(35, 65), [(1, 1), (1.6, .32)])
    return roar + spray


def heat(rng):
    t = timeline(1.23)
    bed = noise(t, rng, 68, 860) * (.21 + .09 * np.sin(TAU * 3.7 * t))
    sparks = np.zeros_like(t)
    hiss = noise(t, rng, 780, 5700)
    for delay in rng.uniform(.02, 1.02, 14):
        age = np.maximum(0, t - delay)
        sparks += (t > delay) * np.exp(-rng.uniform(57, 185) * age) * rng.uniform(.11, .34)
    return (bed + hiss * sparks) * smooth(t / .042) * (1 - smooth((t - .79) / .43))


def gas(rng):
    t = timeline(.97)
    valve = .26 * ring(t, .015, 740, 55, [(1, 1), (2.3, .48)])
    pressure = smooth(t / .026) * (1 - smooth((t - .45) / .50)) * np.exp(-.70 * t)
    return valve + pressure * (.48 * noise(t, rng, 1600, 8800) + .12 * noise(t, rng, 570, 1450))


def crash(rng):
    t = timeline(1.26)
    wreck = .57 * noise(t, rng, 70, 1400) * np.exp(-10 * t)
    modes = [(1, 1), (2.42, .34), (4.33, .21)]
    for delay, pitch, weight in [(0, 58, .87), (.068, 84, .45), (.176, 233, .25), (.27, 108, .18)]:
        wreck += weight * ring(t, delay, pitch, 7.9, modes)
    grit = noise(t, rng, 920, 6200)
    for delay in [.02, .049, .145, .23, .363, .59, .72]:
        age = np.maximum(0, t - delay)
        wreck += .25 * np.exp(-31 * age) * (t > delay) * grit
    return wreck


def bump(rng):
    t = timeline(.34)
    hit = smooth(t / .003) * np.exp(-18 * t)
    return hit * (.72 * tone(62 + 86 * np.exp(-26 * t)) + .32 * noise(t, rng, 75, 730))


def stop_engine(rng):
    t = timeline(2.38)
    coast = 1 - smooth(t / 2.3)
    phase = TAU * np.cumsum(1.5 + 14.5 * coast) / RATE
    blades = (.5 + .5 * np.cos(phase)) ** 4
    wash = .31 * noise(t, rng, 60, 580) * (.11 + .89 * blades)
    turbine = .14 * tone(38 + 180 * coast) + .045 * tone(116 + 240 * coast)
    return (wash + turbine + .25 * blades * np.sin(4 * phase)) * np.sqrt(coast) * smooth(t / .09)


def winch(rng):
    t = timeline(2)
    # Integer-cycle motor, ratchet and circular noise keep sustained lifts smooth.
    gears = TAU * 91 * t + .24 * np.sin(TAU * 7 * t)
    teeth = .5 + .5 * np.cos(TAU * 23 * t)
    return (.37 * np.sin(gears) + .25 * np.sin(gears * 2) + .09 * np.sin(gears * 5)
            + .085 * noise(t, rng, 480, 2400) * (.2 + teeth ** 2))


def splash(rng):
    t = timeline(.74)
    surface = .45 * noise(t, rng, 95, 680) * smooth(t / .016) * np.exp(-8 * t)
    spray = .21 * noise(t, rng, 900, 4700) * smooth(t / .055) * np.exp(-6.3 * t)
    for delay in [.095, .17, .22, .37, .45, .54]:
        spray += .075 * ring(t, delay, rng.uniform(480, 1290), 34, [(1, 1), (1.6, .38)])
    return surface + spray


def door_open(rng):
    t = timeline(.69)
    latch = ring(t, .008, 386, 28, [(1, .5), (2.32, .28), (5.1, .16)])
    movement = smooth((t - .045) / .07) * (1 - smooth((t - .31) / .23))
    hinge = .16 * tone(315 + 115 * smooth(t / .38) + 7 * np.sin(TAU * 30 * t))
    return latch + (hinge + .12 * noise(t, rng, 320, 2220)) * movement


def door_close(rng):
    t = timeline(.48)
    frame = ring(t, .09, 102, 16, [(1, .81), (2.3, .24), (4.8, .095)])
    latch = ring(t, .116, 692, 27, [(1, .32), (2.37, .095)])
    movement = .08 * noise(t, rng, 75, 1500) * smooth(t / .023) * (1 - smooth((t - .085) / .079))
    return movement + frame + latch


def traffic_horn(_rng):
    t = timeline(.64)
    bend = 1 - .06 * np.exp(-24 * t) + .003 * np.sin(TAU * 7.2 * t)
    horn = .37 * tone(352 * bend) + .22 * tone(442 * bend)
    horn += .15 * tone(704 * bend) + .11 * tone(884 * bend) + .094 * tone(1056 * bend)
    return horn * smooth(t / .038) * (1 - smooth((t - .46) / .14))


def train(rng):
    t = timeline(3.6)
    pass_by = smooth(t / .74) * (1 - smooth((t - 2.37) / 1.23))
    rumble = .34 * noise(t, rng, 50, 390) + .10 * noise(t, rng, 450, 1840)
    hum = .12 * tone(137 - 22 * smooth(t / 3)) + .065 * tone(288 - 52 * smooth(t / 3))
    rails = np.zeros_like(t)
    wear = noise(t, rng, 420, 2360)
    for delay in np.arange(.18, 3.45, .48):
        for wheel in (delay, delay + .076):
            age = np.maximum(0, t - wheel)
            rails += (t >= wheel) * np.exp(-39 * age) * (.31 * wear + .33 * np.sin(TAU * 173 * age))
    return (rumble + hum + rails) * pass_by


def flame_alarm(_rng):
    t = timeline(1.64)
    bell = np.zeros_like(t)
    for delay in (0, .23, .46, .82, 1.05, 1.28):
        bell += ring(t, delay, 850, 14, [(1, .35), (1.54, .54), (2.76, .3), (4.48, .12)])
    return bell


def service_siren(kind):
    t = timeline(2.60)
    if kind == "fire":
        hz = 346 + 424 * (.5 - .5 * np.cos(TAU * t / 1.98))
        horn = .17 * tone(hz / 2) + .30 * tone(hz) + .21 * tone(hz * 2) + .17 * tone(hz * 3) + .08 * tone(hz * 5)
    elif kind == "ambulance":
        change = np.tanh(9 * np.sin(TAU * t / .76))
        hz = 635 + 106 * change + 2.5 * np.sin(TAU * 8 * t)
        horn = .52 * tone(hz) + .23 * tone(hz * 2) + .11 * tone(hz * 3)
    else:
        yelp = .5 - .5 * np.cos(TAU * t / .37)
        hz = 496 + 555 * yelp
        horn = .46 * tone(hz) + .27 * tone(hz * 3) + .09 * tone(hz * 5)
    return horn * smooth(t / .052) * (1 - smooth((t - 2.36) / .22))


def canister(rng):
    t = timeline(.43)
    pop = smooth(t / .002) * np.exp(-33 * t)
    return pop * (.44 * noise(t, rng, 180, 4300) + .62 * tone(98 + 225 * np.exp(-47 * t))
                  ) + ring(t, .115, 720, 29, [(1, .16), (2.2, .10)])


def douse(rng):
    t = timeline(1.26)
    steam = smooth(t / .077) * np.exp(-1.5 * t) * (1 - smooth((t - .68) / .55))
    fizz = noise(t, rng, 1050, 6300) * (.75 + .25 * np.sin(TAU * 10.2 * t))
    simmer = noise(t, rng, 230, 2200)
    return steam * (.40 * fizz + .19 * simmer) + .12 * np.exp(-8 * t) * noise(t, rng, 72, 550)


SOUNDS = [
    ("COPLOOP", rotor, .205), ("CHOPSTAR", start_engine, .165), ("BLIP1", blip, .155),
    ("CA_CHING", reward, .155), ("TSCREECH", brakes, .205), ("SIREN", siren, .205),
    ("FIRESTAR", ignition, .165), ("WATERCAN", water, .185), ("FIREDMG", heat, .175),
    ("GASOUT", gas, .175), ("CRSH2", crash, .195), ("SOFTBMP2", bump, .14),
    ("CHOPSTOP", stop_engine, .15), ("WINCHLP", winch, .16), ("SPLISH", splash, .165),
    ("DOROPN", door_open, .14), ("DORCLS", door_close, .16), ("HORN1", traffic_horn, .19),
    ("TRAIN1", train, .19), ("FIREALRT", flame_alarm, .16),
    ("FIRESIRE", lambda _rng: service_siren("fire"), .20),
    ("AMBSRN11", lambda _rng: service_siren("ambulance"), .2),
    ("POLICESI", lambda _rng: service_siren("police"), .20),
    ("TGPOP", canister, .17), ("DOUSE", douse, .18),
]


def main():
    OUT.mkdir(parents=True, exist_ok=True)
    for index, (name, render, target_rms) in enumerate(SOUNDS):
        signal = render(np.random.default_rng(4827 + index))
        signal -= np.mean(signal)
        if name not in ("COPLOOP", "WINCHLP"):
            # Guaranteed zero endpoints for one-shots, even short noisy transients.
            t = np.arange(len(signal)) / RATE
            signal *= smooth(t / .002) * smooth((t[-1] - t) / .014)
        rms = np.sqrt(np.mean(signal ** 2))
        signal *= min(target_rms / rms, .85 / np.max(np.abs(signal)))
        pcm = np.rint(signal * 32767).astype("<i2")
        with wave.open(str(OUT / (name + ".wav")), "wb") as output:
            output.setparams((1, 2, RATE, len(pcm), "NONE", "not compressed"))
            output.writeframes(pcm.tobytes())


if __name__ == "__main__":
    main()

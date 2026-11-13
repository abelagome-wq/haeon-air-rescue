"""Render the game's instrumental radio pieces with NumPy and FFmpeg.

Every oscillator, percussion hit and note sequence is generated here. Track IDs
preserve the game's station programming and saved custom sound assignments.
"""
import argparse
import json
from dataclasses import dataclass
from pathlib import Path
import subprocess

import numpy as np


RATE = 32000
TAU = 2 * np.pi
MAJOR = (0, 2, 4, 5, 7, 9, 11)
MINOR = (0, 2, 3, 5, 7, 8, 10)
OUT = Path(__file__).resolve().parents[1] / "art/audio/synth"


@dataclass(frozen=True)
class Tune:
    id: str
    title: str
    style: str
    bpm: int
    key: int
    scale: tuple
    meter: int
    variant: int
    verse: tuple
    bridge: tuple

    def pitch(self, degree, octave=0):
        return self.key + self.scale[degree % 7] + 12 * (degree // 7 + octave)


TUNES = [
    Tune("JAZZ6MX1", "Runway Lights", "jazz", 114, 53, MAJOR, 4, 0,
         (0, 5, 1, 4, 2, 5, 1, 4), (3, 3, 2, 5, 1, 5, 1, 4)),
    Tune("JAZZ5MX1", "Night Ferry", "jazz", 96, 50, MINOR, 4, 1,
         (0, 3, 6, 2, 5, 3, 1, 4), (2, 5, 3, 0, 1, 3, 4, 4)),
    Tune("ROCK2MX2", "Under the Flyover", "rock", 143, 52, MINOR, 4, 0,
         (0, 0, 5, 3, 6, 3, 5, 4), (2, 2, 6, 3, 5, 1, 3, 4)),
    Tune("ROCK3MX2", "Salt Air", "rock", 117, 55, MAJOR, 4, 1,
         (0, 4, 5, 3, 0, 2, 3, 4), (5, 3, 0, 4, 1, 3, 4, 4)),
    Tune("TKNO4MX2", "Low Orbit", "techno", 128, 50, MINOR, 4, 0,
         (0, 0, 5, 5, 2, 2, 6, 4), (3, 5, 6, 6, 1, 3, 4, 4)),
    Tune("TKNO2MX2", "Signal Glass", "techno", 138, 56, MINOR, 4, 1,
         (0, 3, 5, 5, 6, 2, 3, 4), (5, 5, 1, 3, 2, 6, 4, 4)),
    Tune("SUMR3", "Three Windows", "classic", 100, 58, MAJOR, 3, 0,
         (0, 4, 2, 5, 1, 3, 4, 0), (3, 0, 5, 2, 1, 3, 4, 4)),
    Tune("SPRING3", "Westward Crossing", "classic", 92, 53, MINOR, 4, 1,
         (0, 5, 3, 6, 2, 3, 4, 0), (2, 6, 5, 3, 1, 0, 3, 4)),
    Tune("JAZZPIER3", "Tide Table", "jazz", 102, 51, MAJOR, 3, 2,
         (0, 3, 1, 4, 2, 5, 1, 4), (5, 2, 3, 0, 6, 2, 1, 4)),
    Tune("ROCKQUAY3", "Dry Dock Shift", "rock", 126, 45, MINOR, 4, 2,
         (0, 0, 5, 6, 0, 3, 5, 4), (3, 6, 0, 0, 5, 3, 4, 4)),
    Tune("TECHARC3", "Beacon Phase", "techno", 123, 50, MINOR, 4, 2,
         (0, 0, 3, 3, 5, 5, 6, 4), (2, 2, 5, 5, 3, 3, 4, 4)),
    Tune("CLASSINLT", "Inlet at Dawn", "classic", 180, 50, MAJOR, 6, 2,
         (0, 4, 5, 2, 3, 0, 1, 4), (5, 2, 4, 0, 3, 5, 1, 4)),
]


def instrument(kind, midi, duration, attack, release):
    time = np.arange(max(3, round(duration * RATE))) / RATE
    freq = 440 * 2 ** ((midi - 69) / 12)
    phase = TAU * freq * time
    sine = np.sin
    if kind in ("piano", "keys", "mallet", "pluck"):
        harmonics = {"piano": (1, .45, .24, .14, .07), "keys": (1, .23, .14, .05),
                     "mallet": (1, .12, .28), "pluck": (1, .63, .30, .18, .12, .07)}[kind]
        # A short bell transient in the electric keys and plucked voices.
        metallic = .28 if kind in ("keys", "mallet") else .06
        sound = sum(volume * np.exp(-time * (1.2 + n * 1.25)) *
                    sine(phase * n + metallic * np.exp(-time * 20) * sine(phase * 2.02))
                    for n, volume in enumerate(harmonics, 1))
    elif kind in ("strings", "reed"):
        vibrato = (.23 if kind == "strings" else .35) * np.minimum(time * 5, 1) * sine(TAU * 5.25 * time)
        bent = phase + vibrato
        if kind == "reed":
            sound = (.88 * sine(bent) + .24 * sine(2 * bent) + .37 * sine(3 * bent) +
                     .24 * sine(5 * bent) + .09 * sine(7 * bent)) * (1 + .05 * sine(TAU * 4 * time))
        else:
            sound = sum((sine(n * bent) + .53 * sine(n * (bent * 1.002 + .4))) *
                        v for n, v in enumerate((.76, .39, .31, .17, .14, .09, .07), 1))
    elif kind == "guitar":
        # Pick noise and a fret transient both decay into a driven pair of strings.
        bent = phase + .45 * (1 - np.exp(-38 * time))
        strings = sum((sine(n * bent) + .67 * sine(n * (bent * 1.003 + .25))) *
                      np.exp(-time * (.9 + .65 * n)) / n for n in range(1, 8))
        sound = np.tanh(1.45 * strings) * (.70 + .30 * np.exp(-30 * time))
    elif kind == "muted":
        attack_noise = sine(2.8*phase + .4*sine(phase)) * np.exp(-time*52)
        sound = (.76*sine(phase) + .38*sine(2*phase) + .21*sine(3*phase) + .19*attack_noise)*np.exp(-time*14)
    elif kind == "flute":
        air = phase + .024*sine(TAU*5.2*time)
        sound = (.83*sine(air) + .15*sine(2*air) + .06*sine(3*air)) * (1+.05*sine(TAU*4.7*time))
    elif kind == "pulse":
        # Short FM carrier; index closes independently for every sequencer step.
        sound = sine(phase + (1.75*np.exp(-time*15)+.15)*sine(2*phase))*np.exp(-time*4.8)
    elif kind == "analog":
        sound = sum(sine(n * phase + .2 * sine(phase * .5)) *
                    np.exp(-time * (1.1 + n * 3)) / n for n in range(1, 10))
    else:  # Upright, electric and sub bass share a plucked fundamental.
        sound = (sine(phase) + .37 * np.exp(-time * 5) * sine(2 * phase) +
                 .23 * np.exp(-time * 9) * sine(3 * phase)) * np.exp(-time * .9)
    envelope = np.minimum(1, time / attack) * np.minimum(1, (time[-1] - time) / release)
    return sound * envelope


class Mix:
    def __init__(self, tune, seed):
        self.tune = tune
        self.beat = 60 / tune.bpm
        self.rng = np.random.default_rng(seed)
        self.audio = np.zeros((round((24 * tune.meter * self.beat + 1.3) * RATE), 2), np.float32)
        self.position = 0
        self.hits = {}

    def add(self, beat, wave, volume, pan):
        start = round((self.position + beat) * self.beat * RATE)
        length = min(len(wave), len(self.audio) - start)
        if length <= 0:
            return
        angle = (pan + 1) * np.pi / 4
        mono = wave[:length] * volume
        self.audio[start:start+length, 0] += mono * np.cos(angle)
        self.audio[start:start+length, 1] += mono * np.sin(angle)

    def note(self, beat, length, degree, kind, volume, pan=0, octave=0):
        attack, release = (.115, .19) if kind == "strings" else (.047, .09) if kind == "reed" else (.006, .055)
        duration = length * self.beat + release
        wave = instrument(kind, self.tune.pitch(degree, octave), duration, attack, release)
        self.add(beat, wave, volume * self.rng.uniform(.93, 1.06), pan)

    def drum(self, beat, kind, volume, pan=0):
        variant = int(self.rng.integers(4))
        key = kind, variant
        if key not in self.hits:
            duration = {"kick": .32, "snare": .25, "hat": .092, "ride": .27, "brush": .21}[kind]
            t = np.arange(round(duration * RATE)) / RATE
            noise = self.rng.standard_normal(len(t))
            high = np.diff(noise, prepend=0) * .58
            if kind == "kick":
                wave = np.sin(TAU * (48*t + 100 * .034 * (1-np.exp(-t/.034)))) * np.exp(-t*13)
            elif kind == "snare":
                wave = ((.57 * noise + .24 * high) * np.exp(-t * 21) +
                        .42 * np.sin(TAU * 182 * t) * np.exp(-t * 26))
            elif kind == "brush":
                wave = (.58 * high + .23 * noise) * np.minimum(t*34, 1) * np.exp(-t*17)
            else:
                metal = sum(np.sin(TAU * f * t) for f in (2861, 4190, 5011, 6293)) * .09
                wave = (high * .71 + metal) * np.exp(-t * (53 if kind == "hat" else 19))
            self.hits[key] = wave * np.minimum(t * 1300, 1) * np.minimum((t[-1]-t)*110, 1)
        self.add(beat, self.hits[key], volume * self.rng.uniform(.9, 1.05), pan)


def jazz(m, bar, root, following):
    v = m.tune.variant
    for i, note in enumerate((root, root + (2 if bar % 2 else 4), root + (4 if bar % 2 else 2), following - 1)):
        m.note(i, .87, note, "bass", .38, -.08, -1)
    for b in ((.66, 2.66) if (bar + v) % 2 else (0, 1.68, 3.33)):
        for j in (2, 4, 6):
            m.note(b + j*.005, .64, root+j, "keys", .14, -.47)
    for b in range(4):
        m.drum(b, "ride", .12 if b % 2 == 0 else .15, .42)
    for b in (1.66, 3.66):
        m.drum(b, "hat", .12, .34)
    for b in (1, 3):
        m.drum(b, "brush", .19, -.25)
    m.drum(0, "kick", .21)
    if bar in (0, 1, 8, 23):
        return
    phrases = [
        ((.66, .55, 2), (1.66, .87, 4), (2.66, 1.1, 6)),
        ((0, 1.3, 5), (1.66, .29, 4), (2, .6, 2), (2.66, 1, 1)),
        ((.33, .58, 0), (1, .55, 2), (1.66, .3, 4), (2, 1.5, 5)),
        ((0, .59, 4), (.66, .29, 3), (1, 1.2, 2), (2.66, .73, 0)),
    ]
    for at, length, step in phrases[(bar + 2*v + (bar//8)) % 4]:
        m.note(at, length, root+step, "reed" if not v or bar<16 else "mallet", .28, .22, 1 if root+step<5 else 0)


def rock(m, bar, root, following):
    v = m.tune.variant
    rhythm = (0, .75, 1.5, 2.5, 3.5) if v == 0 else (0, 1.5, 2.75)
    if bar % 8 == 7:
        rhythm = (0, 1.5, 2.5, 3)
    for at in rhythm:
        length = .48 if v == 0 else .88
        for step in (0, 4):
            m.note(at, length, root+step, "guitar", .235, -.58)
            m.note(at+.023, length*.95, root+step, "guitar", .118, .66)
        m.note(at, length+.08, root, "bass", .42, -.02, -1)
    for b in ((0, 2, 2.75) if bar%2 else (0, 1.5, 2.5)):
        m.drum(b, "kick", .61)
    for b in (1, 3):
        m.drum(b, "snare", .42, -.13)
    for b in np.arange(0, 4, .5):
        m.drum(b, "ride" if bar//8 == 1 else "hat", .14 if b%1 else .19, .44)
    if bar % 8 == 7:
        m.drum(3.5, "snare", .29, -.05)
        m.drum(3.75, "snare", .22, -.05)
    if bar < 2 or bar in (8, 16):
        return
    phrases = [
        ((.5, .41, 2), (1, .82, 4), (2, .35, 5), (2.5, 1.25, 4)),
        ((0, 1.6, 2), (2, .35, 1), (2.5, .7, 0), (3.5, .35, -1)),
        ((.75, .6, 0), (1.5, .7, 2), (2.5, .36, 4), (3, .8, 6)),
        ((0, 1.22, 4), (1.5, .64, 3), (2.25, 1.35, 2)),
    ]
    for b, length, step in phrases[(bar + v + bar//8)%4]:
        m.note(b, length, root + step, "guitar", .26, .13, 1)


def techno(m, bar, root, following):
    v = m.tune.variant
    breakdown = 8 <= bar < 12
    if not breakdown:
        for b in range(4):
            m.drum(b, "kick", .74)
    for b in (1, 3):
        m.drum(b+.01, "snare", .29 if not breakdown else .14, -.12)
    steps = (.5, 1.25, 1.75, 2.5, 3.5) if not v else (.25, .75, 1.5, 2.25, 2.75, 3.5)
    for i,b in enumerate(steps):
        if not breakdown or i % 2 == 0:
            m.note(b, .23, root + (4 if i==2 else 0), "analog", .49, 0, -1)
    for i,b in enumerate(np.arange(.5, 4, 1)):
        m.drum(b, "ride" if i==3 else "hat", .19, .42)
        if bar >= 12 and i % 2:
            m.drum(b+.25, "hat", .105, -.37)
    for step in (0, 2, 4):
        m.note(.07, 3.70, root+step, "strings", .071, -.29 + step*.12)
    if bar >= 2:
        offsets = (0, 4, 7, 2, 4, 6, 4, 2) if not v else (4, 2, 0, 4, 6, 2, 7, 4)
        for i,step in enumerate(offsets):
            if (bar + i) % 7 == 0 or (breakdown and i % 2):
                continue
            b = i*.5 + (.25 if i==3 else 0)
            m.note(b, .28, root+step, "analog" if v else "mallet", .24, .13 + .28*(-1)**i, 1)
    if bar in (11, 15, 22):
        for b in (3, 3.5, 3.75):
            m.drum(b, "snare", .20+(b-3)*.2)


def classic(m, bar, root, following):
    v, meter = m.tune.variant, m.tune.meter
    strength = .88 + .12 * np.sin((bar % 8)/7*np.pi)
    m.note(0, meter-.17, root, "strings", .30*strength, -.29, -1)
    for i in range(meter * 2):
        tone = ((0, 2, 4, 2, 6, 4) if not v else (0, 4, 2, 4, 6, 4, 2, 4))[i]
        m.note(i*.5, .43, root+tone, "pluck" if not v else "piano", .19*strength, -.46)
    if bar % 8 not in (0, 7):
        for b in range(1, meter):
            m.note(b+.025, .77, root+(2 if b%2 else 4), "strings", .112, .40)
    motifs = (
        (((0, .88, 2), (1, .44, 4), (1.5, .43, 5), (2, .92, 4)),
         ((0, 1.45, 6), (1.5, .45, 5), (2, .9, 2)),
         ((.5, .44, 0), (1, .89, 2), (2, .42, 4), (2.5, .46, 3)),
         ((0, .9, 4), (1, 1.84, 2))),
        (((0, 1.5, 2), (1.5, .45, 1), (2, .95, 0), (3, .85, 2)),
         ((0, .88, 4), (1, .45, 5), (1.5, .4, 6), (2, 1.75, 4)),
         ((.5, .4, 0), (1, .85, 2), (2, .4, 4), (2.5, 1.35, 5)),
         ((0, 1.7, 4), (2, .9, 3), (3, .85, 2)))
    )
    for b,length,step in motifs[v][(bar + bar//8 + v) % 4]:
        m.note(b, length, root+step, "strings", .30*strength, .12, 1 if root+step < 7 else 0)


def tide_table(m, bar, root, following):
    # Three-beat brushed waltz. Bass walks through the turnaround, while the
    # bridge swaps the reed's long melody for a vibraphone answer.
    bridge = 8 <= bar < 16
    m.note(0, 1.64, root, "bass", .42, -.12, -1)
    m.note(2, .78, following-1 if bar%2 else root+4, "bass", .34, -.12, -1)
    for b in ((.67, 2.33) if bar%2 else (1, 2.67)):
        for j in (2, 6):
            m.note(b, .55, root+j, "keys", .20, -.44)
    m.drum(0, "kick", .22)
    for b in (1, 2): m.drum(b, "brush", .22 if b==2 else .15, -.25)
    for b in (0, 1, 1.67, 2): m.drum(b, "ride", .12, .38)
    head=(((0,1.45,4),(1.67,.42,5),(2.33,.55,7)),
          ((.33,.44,6),(1,.88,4),(2,1.15,2)),
          ((.67,.85,3),(1.67,.38,2),(2.33,.6,1)),
          ((0,1.8,0),(2.33,.52,2)))
    middle=(((0,.43,2),(.67,.45,4),(1.67,.5,7),(2.33,.52,6)),
            ((.33,.8,5),(1.67,1.12,4)),((0,.5,3),(1,.43,5),(2,1.05,2)),
            ((0,1.76,1),(2.33,.55,4)))
    if bar in (0, 15): return
    for at,length,n in (middle if bridge else head)[bar%4]:
        note=root+n
        m.note(at,length,note,"mallet" if bridge else "reed",.31,.22,1 if note<4 else 0)
    if bar%4==3: m.drum(2.67,"brush",.21,.15)


def dry_dock_shift(m, bar, root, following):
    # Palm-muted riff leaves room for the bass. Eight half-time bridge bars
    # open the guitars into sustained fifths; the last chorus restores the riff.
    bridge=8<=bar<16
    attacks=(0,2.5) if bridge else (0,.75,1.5,2.75,3.5)
    for at in attacks:
        voice="guitar" if bridge or at==0 else "muted"
        length=1.44 if bridge else .43
        for step in (0,4):
            m.note(at,length,root+step,voice,.265,-.55)
            m.note(at+.025,length*.93,root+step,voice,.16,.61)
        m.note(at,.90 if bridge else .49,root,"bass",.45,-.03,-1)
    for at in ((0,3.25) if bridge else (0,1.5,2.5)): m.drum(at,"kick",.58)
    for at in ((2,) if bridge else (1,3)): m.drum(at,"snare",.45,-.08)
    for i in range(8): m.drum(i*.5,"ride" if bridge else "hat",.13 if i%2 else .18,.35)
    riffs=(((.5,.65,4),(1.5,.33,5),(2,.55,6),(3,1,4)),
           ((0,1.22,2),(1.75,.45,3),(2.5,1.40,0)),
           ((.5,.50,2),(1.25,.50,4),(2,.50,5),(3,1.20,4)),
           ((0,1.65,2),(2.5,.42,1),(3.25,.60,0)))
    if bar>=2 and (not bridge or bar%2==1):
        for at,length,n in riffs[bar%4]:
            m.note(at,length,root+n,"guitar",.25,.16,1)
    if bar in (7,15,22):
        for at in (3,3.5,3.75): m.drum(at,"snare",.24+(at-3)*.18,.04)


def beacon_phase(m, bar, root, following):
    # A sixteen-step FM pulse moves between stereo positions. At the bridge
    # the kick drops out, leaving low sustained chords and the high beacon.
    breakdown=8<=bar<12
    if not breakdown:
        for b in range(4):
            m.drum(b,"kick",.65);m.drum(b+.5,"hat",.20,.49)
            m.note(b+.5,.38,root,"bass",.42,-.05,-1)
        for b in (1,3):m.drum(b,"snare",.24,-.12)
    for j in (0,2,4):
        m.note(0,3.82,root+j,"strings",.11 if breakdown else .065,(j-2)*.16)
    steps=(0,7,4,2,None,4,7,None,0,2,None,6,4,None,2,4)
    for i,n in enumerate(steps):
        if n is None or breakdown and i%4 or bar<2 and i%2: continue
        if bar>=16 and i%8==3:n+=7
        m.note(i/4,.21,root+n,"pulse",.27 if i%4 else .37,.48*np.sin(i*np.pi/4),0)
    if bar%2==1 or breakdown:
        m.note(.75,1.24,root+7+(2 if bar%4==3 else 0),"mallet",.24,.33)
        m.note(2.75,.77,root+4,"mallet",.17,-.34)
    if bar in (7,15,22):
        for b in (3,3.375,3.625,3.875):m.drum(b,"snare",.13+(b-3)*.23)


def inlet_at_dawn(m, bar, root, following):
    # Two dotted-quarter pulses in 6/8 with independent harp, cello and flute.
    bridge=8<=bar<16
    m.note(0,2.8,root,"strings",.31,-.26,-1)
    m.note(3,2.76,root+(2 if bar%2 else 4),"strings",.23,-.26,-1)
    pattern=(0,2,4,7,4,2) if bar%2==0 else (0,4,7,6,4,2)
    for i,n in enumerate(pattern):m.note(i+.025,.68,root+n,"pluck",.19,-.45)
    melody=(((0,2.48,4),(2.5,.45,5),(3,1.5,6),(5,.83,4)),
            ((0,2.85,2),(3,2.75,0)),((.5,1.45,2),(2,.83,3),(3,2.4,5)),
            ((0,1.85,4),(2,.84,2),(3,2.75,1)))
    for at,length,n in melody[(bar+(1 if bridge else 0))%4]:
        m.note(at,length,root+n,"strings" if bridge else "flute",.29,.19,1)
    if bridge or bar>=16:
        m.note(.12,2.36,root+2,"flute" if bridge else "strings",.13,-.12)
        m.note(3.12,2.4,root+4,"flute" if bridge else "strings",.14,-.12)


NEW_SCORES={"JAZZPIER3":tide_table,"ROCKQUAY3":dry_dock_shift,"TECHARC3":beacon_phase,
            "CLASSINLT":inlet_at_dawn}


def render(tune, seed, ffmpeg, out=OUT):
    score = Mix(tune, seed)
    progression = tune.verse + tune.bridge + tune.verse[:6] + (4, 0)
    arrange = NEW_SCORES.get(tune.id) or {"jazz": jazz, "rock": rock, "techno": techno, "classic": classic}[tune.style]
    for bar, root in enumerate(progression):
        score.position = bar * tune.meter
        if bar < 23:
            arrange(score, bar, root, progression[bar+1])
        else:
            kind = {"jazz": "keys", "rock": "guitar", "techno": "mallet", "classic": "strings"}[tune.style]
            for i, note in enumerate((0, 2, 4, 7)):
                score.note(i*.036, tune.meter-.6, note, kind, .21, -.36 + i*.24)
            score.note(0, tune.meter-.6, 0, "bass", .42, .04, -1)
            if tune.style != "classic":
                score.drum(0, "kick", .53)
                score.drum(0, "ride", .25, .4)
    audio = score.audio
    # Cross-channel early reflections, followed by a short diffuse room tail.
    dry = audio.copy()
    for delay, amount in ((.037, .07), (.071, .056), (.119, .045), (.183, .030), (.263, .017)):
        samples = int(delay * RATE)
        audio[samples:] += dry[:-samples, ::-1] * amount
    audio = np.tanh(audio * 1.1)
    audio *= .85 / np.max(np.abs(audio))
    audio[-RATE:] *= np.linspace(1., 0., RATE)[:, None]
    output = out / (tune.id + ".mp3")
    subprocess.run([ffmpeg, "-hide_banner", "-loglevel", "error", "-y", "-f", "f32le",
                    "-ar", str(RATE), "-ac", "2", "-i", "pipe:0",
                    "-af", "loudnorm=I=-17:TP=-1.5:LRA=9", "-ar", "44100",
                    "-codec:a", "libmp3lame", "-b:a", "96k" if tune.id in NEW_SCORES else "128k",
                    "-metadata", "title=" + tune.title, "-metadata", "artist=" +
                    ("Haeon City Radio" if tune.id in NEW_SCORES else "SimCopter Fan Radio"), str(output)],
                   input=audio.astype("<f4").tobytes(), check=True)
    print(f"{tune.id}: {tune.title}, {len(audio)/RATE:.1f}s", flush=True)


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--ffmpeg", default="ffmpeg")
    parser.add_argument("--tracks", nargs="+", choices=[t.id for t in TUNES], help="render only these IDs")
    parser.add_argument("--out", type=Path, default=OUT)
    args = parser.parse_args()
    args.out.mkdir(parents=True, exist_ok=True)
    songs=[{"id":t.id,"title":t.title,"genre":t.style} for t in TUNES]
    manifest=Path(__file__).resolve().parents[1]/"src/radio-songs.js"
    manifest.write_text("// Generated from the scores in tools/build_synth_music.py.\nexport const radioSongs = [\n" +
                        "".join("  "+json.dumps(row,ensure_ascii=False)+",\n" for row in songs) + "];\n",encoding="utf8")
    for index, tune in enumerate(TUNES):
        if args.tracks is None or tune.id in args.tracks:
            render(tune, 40244+index, args.ffmpeg, args.out)

#!/usr/bin/env python3
"""Original 160 BPM dark-athletic score for the real-footage Motivation Live Cut."""
from array import array
import math, wave, os
SR=48000; DUR=30.0; BPM=160.0; BEAT=60/BPM
os.makedirs('build',exist_ok=True)
OUT='build/MOTIVATION-LIVE-01-original-160bpm.wav'
state=0x273D91A7
def noise():
 global state
 state^=(state<<13)&0xffffffff;state^=state>>17;state^=(state<<5)&0xffffffff
 return (state/2147483647.5)-1
def env(t,k):return math.exp(-t*k) if t>=0 else 0
frames=array('h');last=0
for i in range(int(DUR*SR)):
 t=i/SR;bn=int(t/BEAT);bt=t-bn*BEAT;bar=bn%4
 # Silent tension for the first 0.55 seconds, then a genuinely fast, physical pulse.
 energy=max(0,min(1,(t-.55)/1.1))
 kick=0
 if bt<.17:
  e=env(bt,22); hz=162*math.exp(-bt*25)+47; kick=.46*e*math.sin(2*math.pi*hz*bt)
 bass=0
 if bt<.28:
  hz=(46.25,46.25,55,41.2)[bar];e=env(bt,8.6)
  bass=.20*e*math.sin(2*math.pi*hz*bt)+.042*e*math.sin(4*math.pi*hz*bt)
 n=noise();hi=n-last;last=n
 half=t%(BEAT/2);hat=.065*env(half,88)*hi if half<.029 and int(t/(BEAT/2))%2 else 0
 clap=.085*env(bt,38)*hi if bar in (1,3) and bt<.075 else 0
 # punchy cold-gold harmonic bed rather than a borrowed melody
 root=(77.78,92.5,103.83,82.41)[int(t/(BEAT*4))%4]
 pad=.018*math.sin(2*math.pi*root*t)+.010*math.sin(2*math.pi*root*1.5*t+.5)+.005*math.sin(2*math.pi*root*2*t+1.1)
 # Every 2.5-second typography/shot switch gets a specific impact.
 cut=t%2.5;impact=0
 if cut<.18:
  e=env(cut,16);impact=.17*e*math.sin(2*math.pi*(98-70*cut)*cut)
  if cut<.028:impact+=.16*env(cut,82)*hi
 # final brand payoff gains a high energy octave layer.
 if t>26.8: pad+=.026*math.sin(2*math.pi*root*2*t)
 mono=energy*(kick+bass+hat+clap+pad+impact)
 pan=.035*math.sin(2*math.pi*.19*t)
 l=mono*(1+pan)+hat*.016;r=mono*(1-pan)-hat*.016
 frames.append(max(-32767,min(32767,int(l*32767))));frames.append(max(-32767,min(32767,int(r*32767))))
with wave.open(OUT,'wb') as f:
 f.setnchannels(2);f.setsampwidth(2);f.setframerate(SR);f.writeframes(frames.tobytes())
print(OUT)

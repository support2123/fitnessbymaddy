#!/usr/bin/env python3
"""Original 145 BPM cinematic-hybrid music: no sampled or third-party music."""
from array import array
import math, wave
SR=48000; DUR=30.0; BPM=145.0; BEAT=60/BPM
OUT='build/MOTIVATION-01-original-145bpm.wav'
state=0x41E95D37
def rand():
 global state
 state^=(state<<13)&0xffffffff;state^=state>>17;state^=(state<<5)&0xffffffff
 return (state/2147483647.5)-1
def e(t,k):return math.exp(-t*k) if t>=0 else 0
frames=array('h');last=0
# Every three seconds aligns to a visual chapter; end-card gets a final resolve.
chapters=[0,3,6,9,12,15,18,21,24,27]
for i in range(int(DUR*SR)):
 t=i/SR;bn=int(t/BEAT);bt=t-bn*BEAT;bar=bn%4;energy=.62+.38*min(1,t/9)
 # aggressive cinematic kick / driving bass
 kick=0
 if bt<.20:
  ee=e(bt,18);hz=145*math.exp(-bt*22)+42;kick=.42*ee*math.sin(2*math.pi*hz*bt)
 bass=0
 if bt<.31:
  root=(46.25,46.25,55,41.2)[bar];ee=e(bt,7.8)
  bass=.19*ee*math.sin(2*math.pi*root*bt)+.035*ee*math.sin(2*math.pi*root*2*bt)
 # close hats + a sharp backbeat, more density after first 6 sec
 n=rand();high=n-last;last=n
 half=t%(BEAT/2);hat=.0
 if t>2 and half<.038 and int(t/(BEAT/2))%2:hat=.052*e(half,75)*high
 clap=.0
 if bar in (1,3) and bt<.09:clap=.085*e(bt,34)*high
 # tense brass-like synth bed creates trailer-scale propulsion without borrowed melody
 chord=(77.78,92.5,103.83,82.41)[int(t/(BEAT*4))%4]
 pad=(.020*math.sin(2*math.pi*chord*t)+.013*math.sin(2*math.pi*chord*1.5*t+.4)+.006*math.sin(2*math.pi*chord*2*t+.9))*(.75+.25*math.sin(2*math.pi*.22*t))
 # 3-second chapter impact. The outro gets the largest sub-drop / final hit.
 impact=0
 dist=min(abs(t-c) for c in chapters)
 if dist<.18:
  ee=e(dist,15);impact=.18*ee*math.sin(2*math.pi*(95-60*dist)*dist)
  if dist<.03:impact+=.12*e(dist,80)*high
 if t>26.6:
  # final score opens up under the branded resolve
  pad*=1.65
 mono=energy*(kick+bass+hat+clap+pad+impact)
 pan=.03*math.sin(2*math.pi*.19*t)
 l=mono*(1+pan)+hat*.012;r=mono*(1-pan)-hat*.012
 frames.append(max(-32767,min(32767,int(l*32767))));frames.append(max(-32767,min(32767,int(r*32767))))
with wave.open(OUT,'wb') as f:
 f.setnchannels(2);f.setsampwidth(2);f.setframerate(SR);f.writeframes(frames.tobytes())
print(OUT)

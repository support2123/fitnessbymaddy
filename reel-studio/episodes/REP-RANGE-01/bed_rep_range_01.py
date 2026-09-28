import json,os,sys
HERE=os.path.dirname(os.path.abspath(__file__));sys.path.insert(0,os.path.join(os.path.dirname(os.path.dirname(HERE)),'tools','engine'))
from bedlib import Bed
T=json.load(open(os.path.join(HERE,'timeline.json')));S={k:v[0] for k,v in T['seg'].items()};E={k:v[1] for k,v in T['seg'].items()}
b=Bed(T['total']);b.drone(49,.045);b.pad([146.83,174.61,220],.012,0,T['total'],detune=.18)
for t,a,f in ((1.35,.08,54),(S['m01']+.2,.07,48),(S['m02']+.2,.07,50),(S['m03']+.2,.08,46),(S['m04']+.2,.08,52),(S['m05']+.2,.075,48),(S['m06'],.10,44)):b.impact(t,a,f)
b.sub_drop(S['m01']+3.4,.075,1);b.riser(S['m02']-.8,.8,.035);b.riser(S['m05']-.8,.8,.04)
for i in range(9):b.stand_tick(S['m00']+1.4+(S['m06']-S['m00']-1.4)*i/8,amp=.026,f=720+i*24)
b.stand_tick(S['m06'],amp=.072,f=980);b.ticks(S['m03'],E['m03'],every=.78,amp=.01);b.write('bed.wav')

import json,os,sys
HERE=os.path.dirname(os.path.abspath(__file__));sys.path.insert(0,os.path.join(os.path.dirname(os.path.dirname(HERE)),'tools','engine'))
from bedlib import Bed
T=json.load(open(os.path.join(HERE,'timeline.json')));S={k:v[0] for k,v in T['seg'].items()};E={k:v[1] for k,v in T['seg'].items()}
b=Bed(T['total']);b.drone(48,.048);b.pad([98.0,146.83,196.0],.013,0,T['total'],detune=.15)
for t,a,f in ((.7,.10,48),(S['m01'],.065,54),(S['m02'],.075,62),(S['m03'],.085,58),(S['m04'],.075,52),(S['m05'],.11,46),(S['m06'],.105,38),(S['m07'],.08,44),(S['m08'],.12,50)):b.impact(t,a,f)
b.riser(S['m02']-.65,.65,.035);b.riser(S['m05']-.75,.75,.048);b.sub_drop(S['m06'],.085,.7)
for t in (S['m00']+1.0,S['m02']+1.2,S['m03']+1.2,S['m04']+1.1,S['m05']+1.1,S['m06']+1.1,S['m08']+1.2):b.stand_tick(t,amp=.028,f=720)
b.stand_tick(S['m08']+1.15,amp=.085,f=970);b.write('bed.wav')

#!/usr/bin/env python3
"""REP-RANGE-01 — live-motion Decode film, driven by measured Clone-3 audio."""
import json, math, os, sys
HERE=os.path.dirname(os.path.abspath(__file__)); ROOT=os.path.dirname(os.path.dirname(HERE))
sys.path.insert(0,os.path.join(ROOT,'tools','engine'))
from filmlib import *
from doctrine_kit import Box, assert_safe, clock_lands_on_cta
TL=json.load(open(os.path.join(HERE,'timeline.json'))); B={k:list(v) for k,v in TL['seg'].items()}; TOTAL=TL['total']; FPS=TL['fps']; TITLE='REP RANGE · DECODE'
STILL={'m00':'hook.jpg','m01':'lie.jpg','m02':'system.jpg','m03':'trade.jpg','m04':'receipt.jpg','m05':'protocol.jpg','m06':'cta.jpg'}; CACHE={}
assert_safe(Box(90,530,990,1290,'headline and proof'))
assert_safe(Box(90,1370,930,1575,'illustrative trace'))

# Film-wide grade: live footage always remains the moving ground, typography sits on a restrained ink wash.
def wash(base, dark=.16):
    lay=Image.new('RGBA',(W,H),(0,0,0,0)); d=ImageDraw.Draw(lay)
    d.rectangle([0,0,W,450],fill=(5,8,11,int(160+dark*210)))
    d.rectangle([0,1220,W,H],fill=(5,8,11,205))
    d.rectangle([0,450,W,1220],fill=(4,7,10,int(35+dark*110)))
    return Image.alpha_composite(base.convert('RGBA'),lay)
def bg(s,t,w,dark=.13):
    # Purpose-built stills, not recycled footage: a slow optical push, lateral drift,
    # depth haze and moving particles make each picture beat visibly alive.
    if s not in CACHE:
        CACHE[s]=Image.open(os.path.join(HERE,'assets','stills',STILL[s])).convert('RGBA')
    u=clamp((t-w[0])/max(.01,w[1]-w[0])); im=CACHE[s]
    scale=1.12+.09*u; ww,hh=int(W*scale),int(H*scale)
    base=im.resize((ww,hh),Image.LANCZOS)
    x=int((ww-W)*(.25+.35*u)); y=int((hh-H)*(.22+.18*math.sin((u+.12)*math.pi)))
    base=base.crop((x,y,x+W,y+H))
    haze=Image.new('RGBA',(W,H),(0,0,0,0)); d=ImageDraw.Draw(haze)
    for i in range(22):
        x=(i*137+int(t*31))%W; y=(i*283+int(t*47))%H; r=1+(i%3)
        d.ellipse((x-r,y-r,x+r,y+r),fill=C['GOLD']+(22+(i%4)*6,))
    return wash(Image.alpha_composite(base,haze),dark)
def label(b,txt,col='GOLD'):
    b=put(b,text_img('DECODE · REP RANGE','mono',19,col,tracking=4.2),(90,278),'lt',opacity=.95,shadow=False)
    return put(b,text_img(txt,'mono',18,'INK',tracking=3.0),(90,326),'lt',opacity=.88,shadow=False)
def card(b,box,p=1,col='GOLD',fill=(8,10,13,200)):
    if p<=0:return b
    lay=Image.new('RGBA',(W,H),(0,0,0,0));d=ImageDraw.Draw(lay);d.rounded_rectangle(box,radius=16,fill=fill[:3]+(int(fill[3]*p),),outline=C[col]+(int(230*p),),width=2)
    return Image.alpha_composite(b.convert('RGBA'),lay)
def stat(b,t,at,big,sub,col='GOLD',xy=(90,650),size=104):
    p=clamp((t-at)/.35); q=1+.08*(1-ease(p)); b=put(b,text_img(big,'anton',size,col,max_w=860),xy,'lt',opacity=p,scale=q,glow='GOLD2' if col=='GOLD' else None,glow_px=11)
    return put(b,text_img(sub,'mono',20,'INK',tracking=1.35,max_w=850),(xy[0],xy[1]+int(size*1.0)),'lt',opacity=p,shadow=False)
def k(b,txt,t,at,xy=(90,620),size=76,col='INK',max_w=860,em=None): return kinetic_words(b,txt,xy,t,at,size=size,col=col,max_w=max_w,emphasis=em,glow='GOLD2' if col=='GOLD' else None)
def micro(b,txt,xy,t,at,col='CYAN'): return put(b,text_img(txt,'mono',18,col,tracking=2.0,max_w=850),xy,'lt',opacity=clamp((t-at)/.22),shadow=False)

def hud(b,t):
    # One living RIR signal drives grade bloom, countdown, telemetry trace, and final CTA landing.
    a=B['m00'][0]+.9; c=B['m06'][0]; u=ease(clamp((t-a)/(c-a))); value=max(1,10-round(9*u))
    if t<a:return b
    lay=Image.new('RGBA',(W,H),(0,0,0,0));d=ImageDraw.Draw(lay);x0,y0,x1,y1=700,250,980,535
    d.rounded_rectangle([x0,y0,x1,y1],radius=20,fill=(6,10,13,210),outline=C['CYAN']+(210,),width=2)
    d.rectangle([727,485,952,489],fill=C['DIM']+(190,)); pos=int(727+225*u);d.rectangle([727,485,pos,489],fill=C['GOLD']+(250,));d.ellipse([pos-10,475,pos+10,495],fill=C['GOLD'],outline=C['INK'],width=2)
    for n in range(10):
        x=int(727+225*n/9);d.line([x,479,x,495],fill=C['INK']+(130,),width=1)
    b=Image.alpha_composite(b.convert('RGBA'),Image.new('RGBA',(W,H),C['GOLD']+(int(17*u),)))
    b=Image.alpha_composite(b,lay)
    b=put(b,text_img('ONE SET · REPS IN RESERVE','mono',13,'INK',tracking=.35),(720,278),'lt',opacity=.95,shadow=False)
    b=put(b,text_img(str(value),'anton',88,'GOLD'),(945,314),'rt',opacity=.98,glow='GOLD2',glow_px=15)
    pts=[]
    for i in range(20):
        q=i/19; pts.append((q,.85-.58*ease(q)))
    b=trace(b,(720,410,230,58),pts,col='CYAN',width=3,glow=7,alpha=.8,head=True)
    b=put(b,text_img('RIR TRACE','mono',13,'DIM',tracking=1.6),(720,395),'lt',opacity=.9,shadow=False)
    if t>=c: assert clock_lands_on_cta(1,1)
    return b

def hook(t):
    w=[0,B['m01'][0]];b=bg('m00',t,w,.06);b=label(b,'THE QUESTION')
    b=k(b,'30% = 80%?',t,.82,(90,610),116,'INK');b=micro(b,'LIGHT OR HEAVY · BOTH TAKEN TO FAILURE',(90,770),t,1.42,'GOLD')
    b=put(b,text_img('UNTRAINED MEN · 10 WEEKS · MRI · TO FAILURE','mono',16,'INK',tracking=.9),(90,1385),'lt',opacity=clamp((t-1.95)/.25),shadow=False)
    return cite(b,'MITCHELL · J APPL PHYSIOL · 2012',bottom=430,left=90)
def lie(t):
    w=B['m01'];b=bg('m01',t,w,.11);b=label(b,'01 / THE LIE')
    b=k(b,'EIGHT TO TWELVE\nBECAME THE RULE.',t,w[0]+.18,(90,575),82,'INK')
    b=stat(b,t,w[0]+2.05,'SAME\nGROWTH','LIGHT ↔ HEAVY · TO FAILURE','GOLD',(90,830),94)
    b=stat(b,t,w[0]+4.3,'28 STUDIES','747 PEOPLE · SIMILAR GROUP AVERAGES','CYAN',(90,1100),66)
    return cite(b,'LOPEZ · MSSE · 2021',bottom=430,left=90)
def system(t):
    w=B['m02'];b=bg('m02',t,w,.13);b=label(b,'02 / THE SYSTEM')
    if t<w[0]+6.6:
        b=k(b,'SMALL FIBERS FIRST.',t,w[0]+.2,(90,610),72,'INK');b=k(b,'BIG FIBERS JOIN\nWHEN IT GETS HARD.',t,w[0]+1.25,(90,805),62,'INK',em='HARD')
        return cite(b,'HENNEMAN · SCIENCE · 1957',bottom=430,left=90)
    b=k(b,'CLOSE TO FAILURE.',t,w[0]+6.72,(90,610),76,'INK',em='FAILURE');b=stat(b,t,w[0]+8.1,'20%','TOO LIGHT FOR BEST GROWTH','RED',(90,850),116);b=italic_claim(b,'Stop early, and growth falls behind.',(90,1080),col='CYAN',size=42)
    return cite(b,'LASEVICIUS · JSCR · 2022 · ROBINSON · SPORTS MED · 2024',bottom=430,left=90)
def trade(t):
    w=B['m03'];b=bg('m03',t,w,.12);b=label(b,'03 / THE TRADE')
    if t<w[0]+3.5: b=stat(b,t,w[0]+.16,'1–6','HEAVY REPS · MOST STRENGTH','GOLD',(90,660),145);return cite(b,'LOPEZ · MSSE · 2021 · SCHOENFELD · 2017',bottom=430,left=90)
    if t<w[0]+6.8: b=stat(b,t,w[0]+3.6,'15–30+','LOCAL MUSCLE ENDURANCE','CYAN',(90,660),112);b=italic_claim(b,'Not cardio fitness.',(90,900),col='CYAN',size=46);return cite(b,'SCHOENFELD · SPORTS · 2021',bottom=430,left=90)
    if t<w[0]+10.1: b=k(b,'POWER IS FAST.\nFEW. FRESH.',t,w[0]+6.9,(90,610),80);b=stat(b,t,w[0]+7.55,'−20%','STOP WHEN BAR SPEED FALLS','CYAN',(90,920),104);return cite(b,'PAREJA-BLANCO · SCAND J MED SCI SPORTS · 2017',bottom=430,left=90)
    b=stat(b,t,w[0]+10.25,'+2.9%','SPINE DENSITY','GOLD',(90,625),114);b=k(b,'BONES AND TENDONS\nLIKE HEAVY LOAD.',t,w[0]+10.75,(90,890),57);b=micro(b,'WOMEN · LOW BONE MASS · 8 MONTHS · SUPERVISED',(90,1135),t,w[0]+11.15,'INK')
    return cite(b,'WATSON · JBMR · 2018 · BOHM · SPORTS MED OPEN · 2015',bottom=430,left=90)
def receipt(t):
    w=B['m04'];b=bg('m04',t,w,.1);b=label(b,'04 / THE RECEIPT');b=stat(b,t,w[0]+.2,'585 PEOPLE','SAME PROGRAM · 12 WEEKS · ARM TRAINING','CYAN',(90,570),92);b=stat(b,t,w[0]+1.15,'−2% → +59%','MUSCLE GROWTH RANGE','GOLD',(90,810),88);b=k(b,'EFFORT DECIDES\nHOW CLOSE YOU GET.',t,w[0]+2.2,(90,1050),62)
    return cite(b,'HUBAL · MSSE · 2005',bottom=430,left=90)
def protocol(t):
    w=B['m05'];b=bg('m05',t,w,.1);b=label(b,'05 / THE PROTOCOL');rows=[('BIG LIFTS · 3–6 REPS · 1–2 SHORT',w[0]+.22),('MUSCLE · 6–30 REPS · CLOSE TO FAILURE',w[0]+2.45),('10–20 HARD SETS / MUSCLE / WEEK',w[0]+5.15)]
    for i,(txt,at) in enumerate(rows):
        p=clamp((t-at)/.28);y=605+i*178;b=card(b,(90,y,990,y+123),p);b=put(b,text_img(txt,'anton',39 if i<2 else 45,'GOLD',max_w=830),(125,y+35),'lt',opacity=p,glow='GOLD2',glow_px=10)
    return cite(b,'SCHOENFELD · J SPORTS SCI · 2017 · BAZ-VALLE · J HUM KINET · 2022',bottom=430,left=90)
def cta(t):
    w=[B['m06'][0],TOTAL];b=bg('m06',t,w,.06);b=label(b,'DECODE · REP RANGE');b=k(b,'COUNT HOW CLOSE\nYOU GET.',t,w[0]+.12,(90,785),90,'GOLD');p=clamp((t-(w[0]+.08))/.3);b=card(b,(90,1040,990,1175),p);b=put(b,text_img('COMMENT 30','anton',76,'GOLD'),(540,1070),'ct',opacity=p,glow='GOLD2',glow_px=15);return micro(b,'NEXT: HOW MANY SETS A WEEK.',(90,1245),t,w[0]+2.05,'CYAN')
def frame(t):
    b=hook(t) if t<B['m01'][0] else lie(t) if t<B['m02'][0] else system(t) if t<B['m03'][0] else trade(t) if t<B['m04'][0] else receipt(t) if t<B['m05'][0] else protocol(t) if t<B['m06'][0] else cta(t)
    return finish(hud(b,t),grain=.026,vig=.15,frame=int(t*FPS))

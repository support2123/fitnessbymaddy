#!/usr/bin/env python3
"""SUPPLEMENT-TRUTH-01 — premium evidence-led supplement decision reel."""
import json, math, os, sys
HERE=os.path.dirname(os.path.abspath(__file__)); ROOT=os.path.dirname(os.path.dirname(HERE));sys.path.insert(0,os.path.join(ROOT,'tools','engine'))
from filmlib import *
TL=json.load(open(os.path.join(HERE,'timeline.json')));B={k:list(v) for k,v in TL['seg'].items()};TOTAL=TL['total'];FPS=TL['fps'];TITLE='THE SUPPLEMENT CHECKLIST';CACHE={}
def clamp01(x):return max(0,min(1,x))
def card(b,box,p=1,edge='GOLD',fill=(7,10,13,210)):
 if p<=.001:return b
 l=Image.new('RGBA',(W,H),(0,0,0,0));d=ImageDraw.Draw(l);d.rounded_rectangle(box,radius=16,fill=fill[:3]+(int(fill[3]*p),),outline=C[edge]+(int(225*p),),width=2);return Image.alpha_composite(b.convert('RGBA'),l)
def bg(s,t,w,dark=.12):
 if s not in CACHE:CACHE[s]=Image.open(os.path.join(HERE,'assets','stills',f'{s}.jpg')).convert('RGBA')
 u=clamp01((t-w[0])/max(.01,w[1]-w[0]));im=CACHE[s];z=1.12+.10*u;ww,hh=int(W*z),int(H*z);im=im.resize((ww,hh),Image.LANCZOS);x=int((ww-W)*(.20+.45*u));y=int((hh-H)*(.25+.16*math.sin(u*math.pi)));im=im.crop((x,y,x+W,y+H))
 l=Image.new('RGBA',(W,H),(0,0,0,0));d=ImageDraw.Draw(l)
 for i in range(28):
  x=(i*179+int(t*48))%W;y=(i*311+int(t*37))%H;r=1+i%3;d.ellipse((x-r,y-r,x+r,y+r),fill=C['GOLD']+(20+i%5*6,))
 d.rectangle([0,0,W,480],fill=(4,7,10,170));d.rectangle([0,1260,W,H],fill=(4,7,10,210));d.rectangle([0,480,W,1260],fill=(4,7,10,int(35+dark*120)))
 return Image.alpha_composite(im,l)
def label(b,chapter):
 b=put(b,text_img('DECODE · SUPPLEMENTS','mono',18,'GOLD',tracking=4.0),(90,270),'lt',opacity=.96,shadow=False)
 return put(b,text_img(chapter,'mono',17,'INK',tracking=2.6),(90,316),'lt',opacity=.9,shadow=False)
def kw(b,txt,t,at,xy=(90,610),size=78,col='INK',em=None):return kinetic_words(b,txt,xy,t,at,size=size,col=col,max_w=860,emphasis=em,glow='GOLD2' if col=='GOLD' else None)
def micro(b,txt,t,at,xy=(90,530),col='CYAN'):return put(b,text_img(txt,'mono',18,col,tracking=1.8,max_w=850),xy,'lt',opacity=clamp01((t-at)/.2),shadow=False)
def stat(b,big,sub,t,at,xy=(90,700),col='GOLD',size=108):
 p=clamp01((t-at)/.30);b=put(b,text_img(big,'anton',size,col,max_w=850),xy,'lt',opacity=p,scale=1+.08*(1-ease(p)),glow='GOLD2' if col=='GOLD' else None,glow_px=12);return put(b,text_img(sub,'mono',20,'INK',tracking=1.2,max_w=830),(xy[0],xy[1]+size),'lt',opacity=p,shadow=False)
def hud(b,t):
 # A changing decision rail keeps a small high-level graphic alive throughout the reel.
 order=['GAP','FOOD','TEST','PLAN','SKIP'];u=clamp01(t/TOTAL);i=min(4,int(u*5));l=Image.new('RGBA',(W,H),(0,0,0,0));d=ImageDraw.Draw(l);d.rounded_rectangle([735,245,980,400],radius=18,fill=(5,8,11,210),outline=C['CYAN']+(190,),width=2)
 for n in range(5):
  x=758+n*46;d.ellipse([x-7,357,x+7,371],fill=(C['GOLD'] if n<=i else C['DIM'])+(235,))
 b=Image.alpha_composite(b.convert('RGBA'),l);b=put(b,text_img('DECISION PATH','mono',12,'INK',tracking=1.15),(755,267),'lt',opacity=.9,shadow=False);b=put(b,text_img(order[i],'anton',43,'GOLD'),(855,296),'ct',opacity=.96,glow='GOLD2',glow_px=10)
 return b
def hook(t):
 w=[0,B['m01'][0]];b=bg('m00',t,w,.08);b=label(b,'THE FIRST QUESTION');b=kw(b,'WHAT GAP\nAM I FILLING?',t,.75,(90,600),92,'INK',em='GAP');b=micro(b,'NOT A SHELF. A DECISION.',t,1.65,(90,820),'GOLD');return cite(b,'NIH ODS · MULTIVITAMIN / MINERAL',bottom=430,left=90)
def protein(t):
 w=B['m01'];b=bg('m01',t,w,.12);b=label(b,'01 / PROTEIN');b=kw(b,'POWDER IS NOT\nMAGIC.',t,w[0]+.12,(90,620),82);b=stat(b,'FOOD FIRST','POWDER = CONVENIENCE',t,w[0]+.75,(90,870),'GOLD',76);return cite(b,'ICMR-NIN · DIETARY GUIDELINES · 2024',bottom=430,left=90)
def b12(t):
 w=B['m02'];b=bg('m02',t,w,.12);b=label(b,'02 / B12');b=kw(b,'LOW ANIMAL FOOD?',t,w[0]+.15,(90,590),72);b=stat(b,'B12','CHECK THE GAP',t,w[0]+1.0,(90,800),'CYAN',120);b=micro(b,'VEGAN · METFORMIN · ACID-SUPPRESSING DRUGS',t,w[0]+2.1,(90,1035),'INK');return cite(b,'NIH ODS · VITAMIN B12',bottom=430,left=90)
def vitd(t):
 w=B['m03'];b=bg('m03',t,w,.12);b=label(b,'03 / VITAMIN D');b=kw(b,'NOT A UNIVERSAL\nMEGADOSE.',t,w[0]+.12,(90,580),76);b=stat(b,'ASSESS','SUN · RISK · TEST / PLAN',t,w[0]+1.15,(90,850),'GOLD',108);b=micro(b,'LIMITED SUN · DARKER SKIN · KNOWN LOW LEVEL',t,w[0]+2.3,(90,1080),'INK');return cite(b,'NIH ODS · VITAMIN D',bottom=430,left=90)
def iron(t):
 w=B['m04'];b=bg('m04',t,w,.12);b=label(b,'04 / IRON');b=kw(b,'IRON IS NOT\nAN ENERGY DRINK.',t,w[0]+.14,(90,610),77);b=stat(b,'CONFIRMED','TEST OR CLINICIAN-LED PLAN',t,w[0]+1.15,(90,890),'RED',98);return cite(b,'NIH ODS · IRON',bottom=430,left=90)
def creatine(t):
 w=B['m05'];b=bg('m05',t,w,.10);b=label(b,'05 / CREATINE');b=kw(b,'LIFT WEIGHTS?',t,w[0]+.12,(90,575),82);b=stat(b,'3–5 G','CREATINE MONOHYDRATE · DAILY',t,w[0]+1.0,(90,770),'GOLD',126);b=kw(b,'USEFUL.\nNOT ESSENTIAL.',t,w[0]+2.55,(90,1010),62,'INK');return cite(b,'ISSN · CREATINE POSITION STAND',bottom=430,left=90)
def skip(t):
 w=B['m06'];b=bg('m06',t,w,.12);b=label(b,'06 / SKIP');b=kw(b,'FAT BURNERS.\nDETOXES. BOOSTERS.',t,w[0]+.12,(90,575),73,'RED');b=stat(b,'SKIP','MYSTERY BLENDS',t,w[0]+1.35,(90,955),'RED',104);return cite(b,'IOC · SUPPLEMENT CONSENSUS · 2018',bottom=430,left=90)
def safety(t):
 w=B['m07'];b=bg('m07',t,w,.13);b=label(b,'07 / SAFETY');b=kw(b,'MEDICINES?\nPREGNANCY?\nKIDNEY OR LIVER?',t,w[0]+.12,(90,540),62);b=stat(b,'ASK FIRST','CLINICIAN / PHARMACIST',t,w[0]+1.15,(90,970),'GOLD',92);return cite(b,'NIH ODS · SUPPLEMENT SAFETY',bottom=430,left=90)
def cta(t):
 w=[B['m08'][0],TOTAL];b=bg('m08',t,w,.08);b=label(b,'THE CHECKLIST');b=kw(b,'BUY THE GAP.\nNOT THE LABEL.',t,w[0]+.12,(90,680),87,'GOLD');p=clamp01((t-(w[0]+1.15))/.3);b=card(b,(90,1030,990,1170),p);b=put(b,text_img('COMMENT CHECKLIST','anton',62,'GOLD'),(540,1070),'ct',opacity=p,glow='GOLD2',glow_px=15);return micro(b,'SOURCES IN THE CAPTION.',t,w[0]+2.0,(90,1240),'CYAN')
def frame(t):
 b=hook(t) if t<B['m01'][0] else protein(t) if t<B['m02'][0] else b12(t) if t<B['m03'][0] else vitd(t) if t<B['m04'][0] else iron(t) if t<B['m05'][0] else creatine(t) if t<B['m06'][0] else skip(t) if t<B['m07'][0] else safety(t) if t<B['m08'][0] else cta(t)
 return finish(hud(b,t),grain=.025,vig=.15,frame=int(t*FPS))

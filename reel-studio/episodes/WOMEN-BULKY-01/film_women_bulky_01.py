#!/usr/bin/env python3
"""WOMEN-BULKY-01 — scene-led fitness film, never a one-photo poster."""
import json, os, sys
HERE=os.path.dirname(os.path.abspath(__file__)); ROOT=os.path.dirname(os.path.dirname(HERE))
sys.path.insert(0,os.path.join(ROOT,"tools","engine"))
from filmlib import *  # noqa
from hero_open import hero_overlay
from motion_media import MotionDeck, live_scene
from doctrine_kit import Box,assert_safe,clock_lands_on_cta
TL=json.load(open(os.path.join(HERE,"timeline.json"))); B={k:list(v) for k,v in TL["seg"].items()}
TOTAL,FRAMES=TL["total"],TL["frames"]; EP="WOMEN-BULKY-01"; TITLE="BULKY IS NOT\nAN ACCIDENT."
A=lambda n:os.path.join(HERE,"assets",n); HERO=A("hero-athlete.png"); DECK=MotionDeck(HERE); CLOCK_START=B["m02"][0]; CTA_TIME=B["m05"][0]; CLOCK_FINAL=4
assert_safe(Box(90,265,990,770,"scene title")); assert_safe(Box(90,510,960,1230,"proof and movement cards")); assert_safe(Box(90,1370,930,1575,"Living Clock"))

def wash(base,top=50,bottom=110):
 lay=Image.new("RGBA",(W,H),(0,0,0,0)); d=ImageDraw.Draw(lay); d.rectangle([0,0,W,470],fill=(4,7,9,top)); d.rectangle([0,1170,W,H],fill=(4,7,9,bottom)); return Image.alpha_composite(base.convert("RGBA"),lay)
def scene(beat_id,t,w,pan=(0,0),z0=1,z1=1.12,grade=("teal_gold",.26),dark=0):
 # DOCTRINE-04: a selected moving MP4 is the background. Arguments retained only
 # for source compatibility; no photo/Ken-Burns path is allowed in release Film.
 return wash(live_scene(DECK,beat_id,t,w,dark=dark))
def cut(base,t,at,col="GOLD"):
 d=t-at
 if not 0<=d<.26:return base
 return Image.alpha_composite(base.convert("RGBA"),Image.new("RGBA",(W,H),C[col]+(int(255*ip(d,[0,.055,.26],[0,.36,0])),)))
def card(base,box,o=1,edge="GOLD2",fill=(7,9,12,198)):
 if o<=.001:return base
 lay=Image.new("RGBA",(W,H),(0,0,0,0)); d=ImageDraw.Draw(lay); d.rounded_rectangle(box,radius=14,fill=fill[:3]+(int(fill[3]*o),),outline=C[edge]+(int(230*o),),width=2); return Image.alpha_composite(base.convert("RGBA"),lay)
def kinetic(base,txt,xy,t,at,size=88,col="INK",max_w=850,glow=None):
 # Seven-frame overshoot, clip-mask, and y-rise—never a static template panel.
 emphasis="NOTHING" if "NOTHING" in txt.upper() else None
 return kinetic_words(base,txt,xy,t,at,size=size,col=col,max_w=max_w,emphasis=emphasis,glow=glow)
def micro(base,txt,xy,t,at,col="GOLD"):
 return put(base,text_img(txt,"mono",20,col,tracking=3.2),xy,"lt",opacity=clamp((t-at)/.22),shadow=False)
def tag(base,label):return put(base,text_img(label,"mono",20,"GOLD",tracking=5),(90,278),"lt",opacity=.94,shadow=False)
def clock_value(t):return CLOCK_FINAL*ease(clamp((t-CLOCK_START)/max(.001,CTA_TIME-CLOCK_START)))
def clock(t,base):
 # Prominent top-right telemetry: the same smooth curve drives the environment wash,
 # trace, marker, and score tick map. `clock_value(CTA_TIME)` is asserted in frame().
 if t<CLOCK_START:return base
 v=clock_value(t); x0,x1=692,944; y0,y1=318,520
 lay=Image.new("RGBA",(W,H),(0,0,0,0));d=ImageDraw.Draw(lay)
 d.rounded_rectangle([660,250,980,558],radius=22,fill=(5,8,11,204),outline=C["GOLD2"]+(220,),width=2)
 d.rectangle([x0,y1,x1,y1+4],fill=C["DIM"]+(175,))
 m=int(x0+(x1-x0)*v/CLOCK_FINAL)
 d.rectangle([x0,y1,m,y1+5],fill=C["GOLD"]+(248,))
 for i in range(CLOCK_FINAL+1):
  x=int(x0+(x1-x0)*i/CLOCK_FINAL); d.rectangle([x-1,y1-8,x+1,y1+12],fill=C["INK"]+(155,))
 d.ellipse([m-12,y1-12,m+12,y1+12],fill=C["GOLD"],outline=C["INK"],width=2)
 # A small living trace gives the clock a visual history, not only a number.
 pts=[]
 for i in range(25):
  u=i/24; pts.append((u,1-ease(u)*.72))
 base=Image.alpha_composite(base.convert("RGBA"),Image.new("RGBA",(W,H),C["GOLD"]+(int(13+18*v/CLOCK_FINAL),)))
 base=Image.alpha_composite(base.convert("RGBA"),lay)
 base=trace(base,(692,390,252,76),pts,col="CYAN",width=3,glow=6,alpha=.76,head=True)
 base=put(base,text_img("ADAPTATION WINDOW","mono",16,"INK",tracking=1.7),(692,282),"lt",opacity=.92,shadow=False)
 base=put(base,text_img(f"WEEK {int(round(v)):02d}","anton",66,"GOLD"),(944,323),"rt",opacity=.98,glow="GOLD2",glow_px=14)
 base=put(base,text_img("WEEK 0","mono",14,"DIM",tracking=1.5),(692,538),"lt",opacity=.88,shadow=False)
 base=put(base,text_img("WEEK 4","mono",14,"DIM",tracking=1.5),(944,538),"rt",opacity=.88,shadow=False)
 # CTA exact-frame landing has a visible impact paired with the bed's final clock tick.
 pulse=math.exp(-((t-CTA_TIME)/.16)**2)
 if pulse>.002:
  flashlay=Image.new("RGBA",(W,H),C["GOLD"]+(int(72*pulse),));base=Image.alpha_composite(base.convert("RGBA"),flashlay)
 return base
def hook(t):
 b=live_scene(DECK,"m00",t,[0,B["m01"][0]],dark=.04)
 return hero_overlay(b,t,TITLE,kicker="DECODE · WOMEN'S STRENGTH",hold_frames=21,text_opacity=1-clamp((t-B["m00"][1])/.36))
def myth(t):
 w=B["m01"];b=cut(scene("m01",t,w,pan=(-.13,.04),z0=1.03,z1=1.18,grade=("warm",),dark=.04),t,w[0]);b=tag(b,"THE MYTH");b=micro(b,"ONE LIFT.",(90,560),t,w[0]+.16,"RED");b=kinetic(b,"ONE SESSION",(90,610),t,w[0]+.32,108,glow="RED");b=kinetic(b,"CHANGES NOTHING.",(90,742),t,w[0]+.68,69);b=italic_claim(b,"Fear is not evidence.",(90,895),col="CYAN",o=1,size=43);p=clamp((t-(w[0]+1.1))/1);lay=Image.new("RGBA",(W,H),(0,0,0,0));d=ImageDraw.Draw(lay);r=int(92+132*ease(p));d.ellipse([540-r,1270-r,540+r,1270+r],outline=C["GOLD"]+(int(200*(1-p*.55)),),width=4);return Image.alpha_composite(b.convert("RGBA"),lay)
def adaptation(t):
 w=B["m02"];b=cut(scene("m02",t,w,pan=(.12,-.02),z0=1.02,z1=1.16,dark=.02),t,w[0]);b=tag(b,"THE TIME SCALE");b=micro(b,"MUSCLE CHANGE IS MEASURED IN",(90,530),t,w[0]+.18);b=kinetic(b,"4 WEEKS",(90,585),t,w[0]+.35,118,"GOLD",glow="GOLD");b=kinetic(b,"TO 12 MONTHS",(90,720),t,w[0]+.70,72);b=italic_claim(b,"Not one workout.",(90,865),col="CYAN",o=1,size=46);p=clamp((t-(w[0]+1.25))/1.4);lay=Image.new("RGBA",(W,H),(0,0,0,0));d=ImageDraw.Draw(lay)
 for i in range(4):
  q=clamp((p*4-i)/.75);x=90+i*106;d.rounded_rectangle([x,1015,x+78,1092],radius=8,outline=C["GOLD"]+(180,),width=2);d.rectangle([x+7,1080-int(50*q),x+71,1084],fill=C["GOLD"]+(int(210*q),))
 return cite(Image.alpha_composite(b.convert("RGBA"),lay),"HAGSTROM ET AL. · SPORTS MED · 2020",o=1,bottom=430,left=90)
def receipt(t):
 w=B["m03"];b=cut(scene("m03",t,w,pan=(.06,.02),z0=1.02,z1=1.14,dark=.04),t,w[0]);b=tag(b,"THE RECEIPT");b=card(b,(90,505,990,1125),1,"GOLD",(6,9,12,186));b=micro(b,"MATCHED PROGRAMMES",(130,550),t,w[0]+.16);b=kinetic(b,"10 STUDIES",(130,592),t,w[0]+.28,104,"GOLD",glow="GOLD");b=kinetic(b,"SAME RELATIVE\nGROWTH.",(130,742),t,w[0]+.70,76);p=clamp((t-(w[0]+1.35))/1);lay=Image.new("RGBA",(W,H),(0,0,0,0));d=ImageDraw.Draw(lay)
 for cx,label,col in ((360,"WOMEN",C["GOLD"]),(735,"MEN",C["CYAN"])):
  h=int(116*ease(p));d.rectangle([cx-54,1040-h,cx+54,1040],fill=col+(220,));b=put(b,text_img(label,"mono",18,"INK",tracking=2.4),(cx,1072),"ct",opacity=1,shadow=False)
 return cite(Image.alpha_composite(b.convert("RGBA"),lay),"ROBERTS ET AL. · J STRENGTH COND RES · 2020",o=1,bottom=430,left=90)
def movements(t):
 moves=[("01","SQUAT","m04_squat","SQUAT OR LEG PRESS"),("02","ROW","m04_row","A ROW"),("03","PRESS","m04_press","A PRESS")]
 i=next((n for n,(_,_,beat_id,_) in enumerate(moves) if t<float(DECK.row(beat_id)["end_s"])),2)
 num,name,beat_id,sub=moves[i];st,en=float(DECK.row(beat_id)["start_s"]),float(DECK.row(beat_id)["end_s"])
 b=cut(scene(beat_id,t,[st,en],dark=.03),t,st);b=tag(b,"YOUR FIRST WEEK");b=micro(b,"MOVE "+num+" OF 03",(90,535),t,st+.14);b=kinetic(b,name,(90,585),t,st+.28,146,"GOLD",glow="GOLD")
 b=kinetic(b,sub,(90,810),t,st+.55,46,"INK",max_w=720)
 return italic_claim(b,"Add a rep before adding weight.",(90,1010),col="CYAN",o=1,size=38) if i==2 else b
def cta(t):
 w=[B["m05"][0],TOTAL];b=cut(scene("m05",t,w,pan=(-.07,.01),z0=1.02,z1=1.14,dark=.05),t,w[0]);b=tag(b,"THE REASON TO FOLLOW")
 b=micro(b,"COMMENT: 01 SQUAT · 02 ROW · 03 PRESS",(90,535),t,w[0]+.14,"CYAN")
 b=kinetic(b,"THEN FOLLOW.",(90,575),t,w[0]+.28,92)
 p=clamp((t-(w[0]+1.25))/.35);b=card(b,(90,715,930,858),p,"GOLD",(34,27,13,224));b=put(b,text_img("@FITNESSBYMADDY_","anton",57,"GOLD",max_w=770),(130,754),"lt",opacity=p,glow="GOLD2",glow_px=18)
 b=kinetic(b,"DON'T CHASE BODIES.",(90,920),t,w[0]+2.20,67)
 b=kinetic(b,"LEARN TO READ YOURS.",(90,1010),t,w[0]+3.10,67,"GOLD",glow="GOLD2")
 # Series loop owns the final two seconds, rather than appearing early as a footer.
 return kinetic(b,"NEXT: THE REP-RANGE MISTAKE.",(90,1195),t,TOTAL-2.05,34,"CYAN",max_w=820)
def frame(t):
 b=hook(t) if t<B["m01"][0] else myth(t) if t<B["m02"][0] else adaptation(t) if t<B["m03"][0] else receipt(t) if t<B["m04"][0] else movements(t) if t<B["m05"][0] else cta(t);b=clock(t,b)
 if t>=CTA_TIME:assert clock_lands_on_cta(clock_value(CTA_TIME),CLOCK_FINAL)
 return finish(b,grain=0,vig=.16,frame=int(t*FPS))

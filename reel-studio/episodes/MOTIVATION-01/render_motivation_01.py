#!/usr/bin/env python3
"""FITNESSBYMADDY MOTIVATION-01: 30-second, music-first, research-informed reel."""
from PIL import Image, ImageDraw, ImageFont, ImageFilter
import math, os, random, subprocess, sys

ROOT=os.path.dirname(os.path.abspath(__file__))
AS=os.path.join(ROOT,'assets')
OUT=os.path.join(ROOT,'build')
os.makedirs(OUT,exist_ok=True)
W,H,FPS=768,1376,30
DURATION=30.0
FONT_B='/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf'
FONT_M='/usr/share/fonts/truetype/dejavu/DejaVuSansMono-Bold.ttf'
SCENES=[
 ('shot01.jpg','NO ONE\nIS COMING.','THE WORK STILL WAITS.',None),
 ('shot02.jpg','YOU DON’T\nNEED A MOOD.','YOU NEED A START.',None),
 ('shot07.jpg','SET THE\nCUE.','SAME TIME. SAME PROMISE.','SINGH ET AL. · 2024'),
 ('shot03.jpg','ONE REP.','THEN ANOTHER.',None),
 ('shot04.jpg','ONE MORE.','BEFORE YOU FEEL READY.',None),
 ('shot08.jpg','MOVE WHEN\nIT’S QUIET.','THAT IS THE DIFFERENCE.',None),
 ('shot09.jpg','REPEAT\nTHE PROMISE.','REPETITION BUILDS THE ROUTINE.','SINGH ET AL. · 2024'),
 ('shot10.jpg','YOUR STANDARD\nBUILDS YOU.','NOT ONE PERFECT DAY.',None),
 ('shot05.jpg','START SMALL.\nBUILD WEEKLY.','150 MINUTES · 2 STRENGTH DAYS','WHO · 2020'),
 ('shot06.jpg','SHOW UP.','FITNESSBYMADDY · TRAIN WITH PURPOSE',None),
]
# Fit outputs first, then use a very slight camera movement on every 3-second shot.
def load_bg(name):
 im=Image.open(os.path.join(AS,name)).convert('RGB')
 # fully cover the vertical canvas at native source size
 scale=max(W/im.width,H/im.height)
 return im.resize((round(im.width*scale),round(im.height*scale)),Image.Resampling.LANCZOS)
BGS=[load_bg(s[0]) for s in SCENES]
# Persistent vignette / readability overlays.
shade=Image.new('RGBA',(W,H),(0,0,0,0)); sd=ImageDraw.Draw(shade)
for y in range(H):
 a=int(175*(1-y/H)**1.8 + 128*(y/H)**2.2)
 sd.line((0,y,W,y),fill=(2,5,7,min(210,a)))
# bright but controlled brand colors
GOLD=(226,177,77); CYAN=(70,218,226); WHITE=(244,244,237); DIM=(185,193,191); RED=(231,77,57)

def ease(x):
 x=max(0,min(1,x));return x*x*(3-2*x)
def font(sz,mono=False): return ImageFont.truetype(FONT_M if mono else FONT_B,sz)
def tracked(draw,xy,text,f,fill,spacing=1):
 x,y=xy
 for c in text:
  draw.text((x,y),c,font=f,fill=fill,stroke_width=0)
  x+=draw.textlength(c,font=f)+spacing

def text_block(draw, txt, x, y, size, alpha, scale=1.0):
 # All scenes are preline-broken so the statement remains legible in less than a second.
 f=font(int(size*scale)); lines=txt.split('\n'); cy=y
 for line in lines:
  draw.text((x+3,cy+5),line,font=f,fill=(0,0,0,int(alpha*.64)),stroke_width=2,stroke_fill=(0,0,0,int(alpha*.30)))
  draw.text((x,cy),line,font=f,fill=WHITE+(alpha,),stroke_width=0)
  cy+=int(size*.88*scale)

def crop_motion(im,u,scene):
 # continuous zoom + opposing lateral drift, no static hold
 z=1.055 + .105*(.5+.5*math.sin(u*math.pi*.78+scene*.73))
 rw,rh=round(W*z),round(H*z)
 bg=im.resize((rw,rh),Image.Resampling.LANCZOS)
 dx=max(0,rw-W);dy=max(0,rh-H)
 x=int(dx*(.5+.33*math.sin(u*math.pi+scene*.9)))
 y=int(dy*(.5+.28*math.cos(u*math.pi*.9+scene)))
 return bg.crop((x,y,x+W,y+H)).convert('RGBA')
def frame(t):
 scene=min(9,int(t/3.0)); local=t-scene*3.0; u=local/3.0
 base=crop_motion(BGS[scene],u,scene)
 # 4-frame amber hit / quick dissolve at all cuts.
 if local<.15 and scene>0:
  prev=crop_motion(BGS[scene-1],1.0,scene-1)
  p=ease(local/.15)
  base=Image.blend(prev,base,p)
  hit=Image.new('RGBA',(W,H),(255,193,87,int((1-p)*80)))
  base=Image.alpha_composite(base,hit)
 base=Image.alpha_composite(base,shade)
 d=ImageDraw.Draw(base)
 # quiet technical system elements keep each photographic beat alive.
 d.line((42,214,42,1160),fill=GOLD+(150,),width=3)
 d.rectangle((42,214,49,214+int(946*u)),fill=CYAN+(220,),outline=None)
 tracked(d,(67,95),'FITNESSBYMADDY / 01',font(14,True),GOLD+(220,),2)
 tracked(d,(67,126),f'{int(t*1000):05d} MS  /  BUILD THE STANDARD',font(11,True),DIM+(165,),1)
 # moving scanline and particles
 scan_y=int(310+math.sin(t*5.5+scene)*260)
 d.line((64,scan_y,W-58,scan_y),fill=CYAN+(42,),width=1)
 random.seed(int(t*30)+scene*1000)
 for _ in range(16):
  px=random.randint(62,W-62);py=random.randint(235,H-230);r=random.choice((1,1,2))
  d.ellipse((px-r,py-r,px+r,py+r),fill=GOLD+(random.randint(24,64),))
 title,sub,chip=SCENES[scene][1:]
 # text snaps in within first 0.28 seconds then gets a slow micro-scale pulse
 p=ease(local/.27); sc=.91+.09*p + .014*math.sin(local*4)
 text_block(d,title,69,415,75,int(255*p),sc)
 sub_y=415+int(75*.88*sc)*len(title.split('\n'))+34
 tracked(d,(72,sub_y),sub,font(16,True),GOLD+(int(240*p),),1.0)
 if chip:
  chipw=min(W-138,int(d.textlength(chip,font=font(12,True))+32))
  by=1123
  d.rounded_rectangle((69,by,69+chipw,by+35),radius=6,fill=(5,12,15,210),outline=CYAN+(205,),width=1)
  tracked(d,(83,by+10),chip,font(12,True),CYAN+(230,),.7)
 # outro mark: no spoken CTA; brand remains visible at precisely the payoff.
 if scene==9:
  p=ease((local-.34)/.38)
  d.rounded_rectangle((69,1040,W-69,1158),radius=10,fill=(7,12,15,int(215*p)),outline=GOLD+(int(230*p),),width=2)
  tracked(d,(94,1063),'FITNESSBYMADDY',font(30),GOLD+(int(255*p),),1.0)
  tracked(d,(96,1112),'TRAIN WITH PURPOSE.',font(14,True),WHITE+(int(235*p),),1.2)
 return base.convert('RGB')

ff=os.environ['FFMPEG']
visual=os.path.join(OUT,'MOTIVATION-01-visual-768.mp4')
cmd=[ff,'-y','-v','error','-f','rawvideo','-pix_fmt','rgb24','-s',f'{W}x{H}','-r',str(FPS),'-i','-','-an','-c:v','libx264','-preset','medium','-crf','16','-pix_fmt','yuv420p','-movflags','+faststart',visual]
p=subprocess.Popen(cmd,stdin=subprocess.PIPE)
for i in range(round(DURATION*FPS)):
 p.stdin.write(frame(i/FPS).tobytes())
p.stdin.close()
if p.wait()!=0: raise SystemExit('visual render failed')
# Extract an exact direct frame-zero cover before muxing; video gets copied during mux.
cover=os.path.join(ROOT,'MOTIVATION-01-cover.png')
subprocess.run([ff,'-y','-v','error','-i',visual,'-frames:v','1',cover],check=True)
print(visual)
print(cover)

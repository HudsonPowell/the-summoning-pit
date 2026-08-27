import json, math
from PIL import Image, ImageDraw
src=open("src/type/plate.ts").read()
b=src[src.index("Trace[]> = {")+len("Trace[]> = {"):src.rindex("};")]
D=json.loads("{"+b.rstrip().rstrip(",")+"}")
items=[(k,i,s) for k,v in D.items() for i,s in enumerate(v) if len(s)>=8]
CW,CH,PER=340,340,6
rows=(len(items)+PER-1)//PER
img=Image.new("RGB",(CW*PER,CH*rows),(10,10,14)); d=ImageDraw.Draw(img)
for n,(k,i,s) in enumerate(items):
    ox,oy=(n%PER)*CW,(n//PER)*CH
    d.rectangle([ox,oy,ox+CW-1,oy+CH-1],outline=(30,32,40))
    xs=[p[0] for p in s]; ys=[p[1] for p in s]
    w=max(xs)-min(xs); h=max(ys)-min(ys)
    S=min(230/max(w,1e-3),230/max(h,1e-3),260)
    cx=(min(xs)+max(xs))/2; cy=(min(ys)+max(ys))/2
    P=lambda p:(ox+CW/2+(p[0]-cx)*S, oy+CH/2+22-(p[1]-cy)*S)
    d.line([P(p) for p in s],fill=(210,170,90),width=5,joint="curve")
    L=[0]
    for j in range(1,len(s)): L.append(L[-1]+math.dist(s[j],s[j-1]))
    T=L[-1]
    for t in [x/10 for x in range(11)]:
        want=t*T; j=min(range(len(L)),key=lambda q:abs(L[q]-want))
        x,y=P(s[j])
        col=(255,255,255) if t in (0.0,1.0) else (90,200,255)
        d.ellipse([x-4,y-4,x+4,y+4],fill=col)
        d.text((x+6,y-6),f"{t:.1f}",fill=col)
    d.text((ox+7,oy+5),f"{k} #{i}",fill=(200,208,222))
    d.text((ox+7,oy+18),f"len {T:.2f}  {w:.2f}x{h:.2f}",fill=(110,118,132))
img.save("/private/tmp/claude-944140629/-Users-hudson-powell-Desktop-Archive-SORT-IT-OUT--Developer-EngineGame/1d180979-f9c5-425c-a91a-10fa3adc93d2/scratchpad/atlas.png")
print(img.size,len(items))

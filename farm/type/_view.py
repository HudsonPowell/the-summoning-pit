import json, re, math
from PIL import Image, ImageDraw
src = open("src/type/plate.ts").read()
body = src[src.index("PLATE: Record<string, Trace[]> = {")+len("PLATE: Record<string, Trace[]> = {"):src.rindex("};")]
data = json.loads("{" + body.rstrip().rstrip(",") + "}")
COLS = [(255,90,90),(90,200,255),(255,210,80),(140,255,140),(220,140,255),(255,160,60),(120,255,220)]
names = list(data)
CW, CH, PER = 300, 320, 6
rows = (len(names)+PER-1)//PER
img = Image.new("RGB",(CW*PER, CH*rows),(10,10,14)); d=ImageDraw.Draw(img)
for i,n in enumerate(names):
    ox, oy = (i%PER)*CW, (i//PER)*CH
    d.rectangle([ox,oy,ox+CW-1,oy+CH-1], outline=(30,32,40))
    d.text((ox+6,oy+4), f"{n}  ({len(data[n])})", fill=(120,128,142))
    S = 210.0
    bx, by = ox+CW/2-0.5*S*0.9, oy+CH-52
    # centre on the piece
    xs=[p[0] for s in data[n] for p in s]; ys=[p[1] for s in data[n] for p in s]
    cx=(min(xs)+max(xs))/2
    for j,s in enumerate(data[n]):
        pts=[(ox+CW/2+(p[0]-cx)*S, oy+CH-40-p[1]*S) for p in s]
        d.line(pts, fill=COLS[j%len(COLS)], width=4, joint="curve")
        d.ellipse([pts[0][0]-4,pts[0][1]-4,pts[0][0]+4,pts[0][1]+4], fill=(255,255,255))
img.save("/private/tmp/claude-944140629/-Users-hudson-powell-Desktop-Archive-SORT-IT-OUT--Developer-EngineGame/1d180979-f9c5-425c-a91a-10fa3adc93d2/scratchpad/parts.png")
print(img.size, len(names))

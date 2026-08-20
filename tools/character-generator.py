"""
The File — archetype character generator.

Reads src/data/archetypes.json (the single source of truth for the cast) and
emits one GLB per archetype into public/models/. Every archetype shares the
same 25-bone Mixamo-named skeleton and the same clip set (idle / walk / jog /
crouch), so one animation library drives all of them; archetypes differ by
silhouette (shoulders, waist, weight, coat length, boots, stoop, attachments)
and by walk gait.

Bodies are lofted from anatomical cross-sections (superelliptical — torsos are
wider than deep). See docs/THE-FILE-bible-v2.md §9.

SIGN CONVENTION (limb bones point downward, -Y):
    hip flexion   (leg swings forward) = NEGATIVE X
    knee flexion  (heel toward back)   = POSITIVE X
    elbow flexion (hand comes up)      = NEGATIVE X

Natural ground speeds are DERIVED, not invented: the bible's base walk
(36° swing over 1.00s) is defined as 2.05 m/s, and every variant's speed
follows from stride geometry:  speed = K * sin(swing) / duration  with
K calibrated so the base walk is exactly 2.05. Jog keeps the bible's
authored 4.05 (its params are unchanged from the bible clip). The speeds
are baked into each GLB's root `extras.naturalSpeeds` so the runtime never
hardcodes them.

Run from the repo root or tools/:  python3 tools/character-generator.py
"""
import json, math, os, sys
import numpy as np
from pygltflib import (GLTF2, Scene, Node, Mesh, Primitive, Attributes, Buffer,
                       BufferView, Accessor, Skin, Animation, AnimationSampler,
                       AnimationChannel, AnimationChannelTarget, Asset,
                       Material, PbrMetallicRoughness)

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
ARCHETYPES = json.load(open(os.path.join(ROOT, 'src/data/archetypes.json')))
OUT_DIR = os.path.join(ROOT, 'public/models')

# ---------------------------------------------------------------- skeleton
J = {
    'Hips':          (0.000, 0.960, 0.000),
    'Spine':         (0.000, 1.055, 0.000),
    'Spine1':        (0.000, 1.165, 0.000),
    'Spine2':        (0.000, 1.285, 0.000),
    'Neck':          (0.000, 1.430, 0.000),
    'Head':          (0.000, 1.510, 0.000),
    'HeadTop_End':   (0.000, 1.700, 0.000),
    'LeftShoulder':  ( 0.045, 1.395, 0.000),
    'LeftArm':       ( 0.175, 1.375, 0.000),
    'LeftForeArm':   ( 0.235, 1.115, 0.000),
    'LeftHand':      ( 0.278, 0.885, 0.000),
    'LeftHand_End':  ( 0.295, 0.790, 0.000),
    'RightShoulder': (-0.045, 1.395, 0.000),
    'RightArm':      (-0.175, 1.375, 0.000),
    'RightForeArm':  (-0.235, 1.115, 0.000),
    'RightHand':     (-0.278, 0.885, 0.000),
    'RightHand_End': (-0.295, 0.790, 0.000),
    'LeftUpLeg':     ( 0.098, 0.935, 0.000),
    'LeftLeg':       ( 0.105, 0.510, 0.000),
    'LeftFoot':      ( 0.108, 0.085, 0.000),
    'LeftToe_End':   ( 0.108, 0.028, 0.145),
    'RightUpLeg':    (-0.098, 0.935, 0.000),
    'RightLeg':      (-0.105, 0.510, 0.000),
    'RightFoot':     (-0.108, 0.085, 0.000),
    'RightToe_End':  (-0.108, 0.028, 0.145),
}
PARENT = {
    'Hips':None,'Spine':'Hips','Spine1':'Spine','Spine2':'Spine1','Neck':'Spine2',
    'Head':'Neck','HeadTop_End':'Head',
    'LeftShoulder':'Spine2','LeftArm':'LeftShoulder','LeftForeArm':'LeftArm',
    'LeftHand':'LeftForeArm','LeftHand_End':'LeftHand',
    'RightShoulder':'Spine2','RightArm':'RightShoulder','RightForeArm':'RightArm',
    'RightHand':'RightForeArm','RightHand_End':'RightHand',
    'LeftUpLeg':'Hips','LeftLeg':'LeftUpLeg','LeftFoot':'LeftLeg','LeftToe_End':'LeftFoot',
    'RightUpLeg':'Hips','RightLeg':'RightUpLeg','RightFoot':'RightLeg','RightToe_End':'RightFoot',
}
BONES = list(J.keys()); BIDX = {b:i for i,b in enumerate(BONES)}
SEG = 14

SPINE = ['Hips','Spine','Spine1','Spine2','Neck','Head']
SPINE_Y = [J[b][1] for b in SPINE]

def spine_weights(y):
    if y <= SPINE_Y[0]:  return [('Hips',1.0)]
    if y >= SPINE_Y[-1]: return [('Head',1.0)]
    for i in range(len(SPINE)-1):
        a,b = SPINE_Y[i], SPINE_Y[i+1]
        if a <= y <= b:
            t = (y-a)/(b-a)
            return [(SPINE[i],1.0-t),(SPINE[i+1],t)]
    return [('Hips',1.0)]

# ------------------------------------------------------------------ builder
class MeshBuilder:
    """Accumulates one primitive. `skinned=False` builds attachment meshes
    with no joint data (they are parented to a bone node instead)."""
    def __init__(self, skinned=True):
        self.verts, self.joints, self.weights, self.tris = [], [], [], []
        self.skinned = skinned

    def add_vert(self, p, bw=None):
        self.verts.append(tuple(p))
        if self.skinned:
            bw = bw or [('Hips',1.0)]
            js=[BIDX[b] for b,_ in bw][:4]; ws=[w for _,w in bw][:4]
            while len(js)<4: js.append(0); ws.append(0.0)
            s=sum(ws) or 1.0
            self.joints.append(js); self.weights.append([w/s for w in ws])
        return len(self.verts)-1

    def sect(self, cx, cy, cz, rx, rz, n=2.0, bw=None):
        """One superelliptical cross-section. `bw` may be a weight list or a
        per-vertex function of (x, y, z) — the greatcoat needs the latter."""
        base=len(self.verts)
        for i in range(SEG):
            a=2*math.pi*i/SEG
            ca,sa=math.cos(a),math.sin(a)
            x=cx+rx*math.copysign(abs(ca)**(2.0/n),ca)
            z=cz+rz*math.copysign(abs(sa)**(2.0/n),sa)
            w = bw((x,cy,z)) if callable(bw) else bw
            self.add_vert((x,cy,z), w if w else spine_weights(cy))
        return base

    def stitch(self, a, b):
        for i in range(SEG):
            j=(i+1)%SEG
            self.tris.extend([a+i,b+i,a+j, a+j,b+i,b+j])

    def cap(self, base, c, bw, flip=False):
        w = bw(c) if callable(bw) else bw
        ci=self.add_vert(c, w)
        for i in range(SEG):
            j=(i+1)%SEG
            self.tris.extend([ci,base+j,base+i] if flip else [ci,base+i,base+j])

    def loft(self, levels, bw=None, capTop=True, capBot=True, n=2.0):
        rings=[]
        for (y,rx,rz,zo) in levels:
            rings.append(self.sect(0,y,zo,rx,rz,n,bw))
        for a,b in zip(rings,rings[1:]): self.stitch(a,b)
        if capBot:
            y,_,_,zo = levels[0]
            self.cap(rings[0],(0,y,zo), bw if bw else spine_weights(y), flip=True)
        if capTop:
            y,_,_,zo = levels[-1]
            self.cap(rings[-1],(0,y,zo), bw if bw else spine_weights(y))
        return rings

    def chain(self, pts):
        """pts: (bone0, bone1, t, radius). Rings placed along bone segments."""
        rings=[]
        for (b0,b1,t,r) in pts:
            p0,p1=np.array(J[b0]),np.array(J[b1])
            pos=p0+(p1-p0)*t
            bw=[(b0,1.0-t*0.62),(b1,t*0.62)] if t<0.5 else [(b0,1.0-t),(b1,t)]
            rings.append(self.sect(pos[0],pos[1],pos[2],r,r*0.92,2.0,bw))
        for a,b in zip(rings,rings[1:]): self.stitch(a,b)
        return rings

    def box(self, pts, bw=None):
        b=len(self.verts)
        for p in pts: self.add_vert(p, bw)
        for f in [(0,1,2),(0,2,3),(4,6,5),(4,7,6),(0,4,5),(0,5,1),
                  (3,2,6),(3,6,7),(0,3,7),(0,7,4),(1,5,6),(1,6,2)]:
            self.tris.extend([b+f[0],b+f[1],b+f[2]])

    def box_at(self, cx,cy,cz, hw,hh,hd, bw=None):
        self.box([(cx-hw,cy+hh,cz-hd),(cx+hw,cy+hh,cz-hd),(cx+hw,cy-hh,cz-hd),(cx-hw,cy-hh,cz-hd),
                  (cx-hw,cy+hh,cz+hd),(cx+hw,cy+hh,cz+hd),(cx+hw,cy-hh,cz+hd),(cx-hw,cy-hh,cz+hd)], bw)

    def finish(self):
        verts=np.array(self.verts,dtype=np.float32)
        tris=np.array(self.tris,dtype=np.uint16)
        norms=np.zeros_like(verts)
        f=tris.reshape(-1,3)
        fn=np.cross(verts[f[:,1]]-verts[f[:,0]], verts[f[:,2]]-verts[f[:,0]])
        for i in range(3): np.add.at(norms,f[:,i],fn)
        ln=np.linalg.norm(norms,axis=1,keepdims=True); ln[ln==0]=1
        norms/=ln
        out={'position':verts,'normal':norms,'index':tris}
        if self.skinned:
            out['skinIndex']=np.array(self.joints,dtype=np.uint16)
            out['skinWeight']=np.array(self.weights,dtype=np.float32)
        return out

# ------------------------------------------------------------------- body
def build_body(m):
    """m: mesh params from archetypes.json."""
    shoulder, waist, weight = m['shoulder'], m['waist'], m['weight']
    limb = m['limb']
    b = MeshBuilder()

    def tf(y):
        """Torso width multiplier: hips → waist → shoulder blend by height."""
        if y < 1.02: f = 1.0
        elif y < 1.16: f = waist
        elif y > 1.30: f = shoulder
        else: f = waist + (shoulder-waist)*(y-1.16)/(1.30-1.16)
        return f * weight

    TORSO = [
        (0.855, 0.163, 0.122, 0.000),
        (0.930, 0.170, 0.126, 0.000),
        (1.010, 0.152, 0.114, 0.002),
        (1.070, 0.143, 0.107, 0.004),   # waist
        (1.150, 0.158, 0.117, 0.004),
        (1.235, 0.180, 0.130, 0.002),   # ribcage
        (1.320, 0.194, 0.129, 0.000),   # chest
        (1.395, 0.188, 0.117,-0.002),   # shoulder line
        (1.445, 0.116, 0.098,-0.004),   # trapezius
        (1.490, 0.061, 0.060,-0.004),   # neck base
        (1.545, 0.056, 0.057,-0.002),
    ]
    b.loft([(y, rx*tf(y), rz*weight, zo) for (y,rx,rz,zo) in TORSO], n=2.6)

    # -- coat, lofted from hem to collar. Below the hip line the hem is
    # part-weighted to the near-side UpLeg so a long coat swings with the
    # stride instead of having thighs punch through it.
    hem, flare = m['coatHem'], m['coatFlare']
    def coat_w(p):
        x, y, _ = p
        if y >= 0.955: return spine_weights(y)
        t = min(1.0, (0.955-y)/max(0.955-hem, 1e-6))
        leg_frac = 0.42*(t**1.5)   # ease in; full-linear 0.5 read as a tail at jog
        side = 'LeftUpLeg' if x >= 0 else 'RightUpLeg'
        return [('Hips',1.0-leg_frac),(side,leg_frac)]

    top = [
        (1.060, 0.176, 0.135, 0.004),
        (1.170, 0.187, 0.140, 0.004),
        (1.270, 0.208, 0.148, 0.002),
        (1.370, 0.213, 0.137, 0.000),
        (1.420, 0.196, 0.122,-0.003),
        (1.452, 0.128, 0.104,-0.005),
    ]
    hem_rx, hem_rz = 0.222*flare, 0.172*flare
    lower=[]
    NL = 4 if hem < 0.70 else 3
    for i in range(NL):
        t = i/(NL-1)          # 0 at hem, 1 at 0.96
        y = hem + (0.960-hem)*t
        rx = hem_rx + (0.199-hem_rx)*t
        rz = hem_rz + (0.152-hem_rz)*t
        lower.append((y, rx, rz, 0.0))
    COAT = lower + top
    b.loft([(y, rx*(tf(y) if y>1.0 else weight), rz*weight, zo) for (y,rx,rz,zo) in COAT],
           bw=coat_w, capTop=False, n=2.7)

    # -- limbs
    boots = m['boots']
    for s in ('Left','Right'):
        r=b.chain([(f'{s}Arm',f'{s}ForeArm',0.00,0.086*limb*shoulder),
                   (f'{s}Arm',f'{s}ForeArm',0.18,0.068*limb),
                   (f'{s}Arm',f'{s}ForeArm',0.55,0.058*limb),
                   (f'{s}Arm',f'{s}ForeArm',1.00,0.053*limb),
                   (f'{s}ForeArm',f'{s}Hand',0.22,0.055*limb),
                   (f'{s}ForeArm',f'{s}Hand',0.62,0.044*limb),
                   (f'{s}ForeArm',f'{s}Hand',1.00,0.036*limb)])
        b.cap(r[0], tuple(np.array(J[f'{s}Arm'])+np.array([0,0.03,0])), [(f'{s}Arm',1.0)])
        hp=np.array(J[f'{s}Hand'])
        h1=b.sect(hp[0],hp[1]-0.02,0.004,0.046,0.026,2.4,[(f'{s}Hand',1.0)])
        h2=b.sect(hp[0],hp[1]-0.070,0.010,0.043,0.024,2.4,[(f'{s}Hand',1.0)])
        h3=b.sect(hp[0],hp[1]-0.100,0.012,0.028,0.018,2.2,[(f'{s}Hand',1.0)])
        b.stitch(r[-1],h1); b.stitch(h1,h2); b.stitch(h2,h3)
        b.cap(h3,(hp[0],hp[1]-0.112,0.012),[(f'{s}Hand',1.0)])

        ankle_r = 0.058 if boots else 0.044*limb
        lr=b.chain([(f'{s}UpLeg',f'{s}Leg',0.00,0.108*limb),
                    (f'{s}UpLeg',f'{s}Leg',0.28,0.098*limb),
                    (f'{s}UpLeg',f'{s}Leg',0.70,0.080*limb),
                    (f'{s}UpLeg',f'{s}Leg',1.00,0.069*limb),
                    (f'{s}Leg',f'{s}Foot',0.18,0.076*limb),   # calf
                    (f'{s}Leg',f'{s}Foot',0.55,0.066 if boots else 0.061*limb),
                    (f'{s}Leg',f'{s}Foot',1.00,ankle_r)])
        b.cap(lr[0], tuple(np.array(J[f'{s}UpLeg'])+np.array([0,0.05,0])), [(f'{s}UpLeg',1.0)])
        fp=np.array(J[f'{s}Foot'])
        k = 1.10 if boots else 1.0
        s1=b.sect(fp[0],fp[1]-0.012,0.010,0.049*k,0.052*k,2.6,[(f'{s}Foot',1.0)])
        s2=b.sect(fp[0],fp[1]-0.048,0.045,0.052*k,0.088*k,3.0,[(f'{s}Foot',1.0)])
        s3=b.sect(fp[0],fp[1]-0.058,0.105,0.046*k,0.058*k,3.0,[(f'{s}Foot',1.0)])
        b.stitch(lr[-1],s1); b.stitch(s1,s2); b.stitch(s2,s3)
        b.cap(s3,(fp[0],fp[1]-0.060,0.140),[(f'{s}Foot',1.0)])
        b.cap(s2,(fp[0],fp[1]-0.062,0.045),[(f'{s}Foot',1.0)],flip=True)

    # -- head (shared across archetypes; identity comes from hats and build)
    HC = J['Head'][1] + 0.082
    HW = [('Head',1.0)]
    HEAD = [
        (HC+0.118, 0.040, 0.046,-0.004),
        (HC+0.100, 0.070, 0.079,-0.006),
        (HC+0.070, 0.086, 0.094,-0.006),
        (HC+0.038, 0.092, 0.100,-0.004),   # temple
        (HC+0.012, 0.091, 0.101, 0.000),   # brow
        (HC-0.012, 0.086, 0.099, 0.002),   # eye line
        (HC-0.040, 0.079, 0.093, 0.004),   # cheek
        (HC-0.066, 0.067, 0.084, 0.006),   # jaw
        (HC-0.090, 0.048, 0.068, 0.010),   # chin
        (HC-0.108, 0.026, 0.040, 0.006),
        (HC-0.135, 0.048, 0.050,-0.006),   # under-jaw into neck
        (HC-0.165, 0.055, 0.056,-0.006),
    ]
    b.loft(HEAD, bw=lambda p: HW, n=2.3)
    # nose
    b.box([(-0.017,HC+0.010,0.086),( 0.017,HC+0.010,0.086),
           ( 0.017,HC-0.038,0.090),(-0.017,HC-0.038,0.090),
           (-0.009,HC+0.004,0.108),( 0.009,HC+0.004,0.108),
           ( 0.011,HC-0.036,0.122),(-0.011,HC-0.036,0.122)], HW)
    # brow ridge — a shallow shelf reads as a face under toon shading
    b.box([(-0.078,HC+0.026,0.070),( 0.078,HC+0.026,0.070),
           ( 0.078,HC+0.014,0.078),(-0.078,HC+0.014,0.078),
           (-0.072,HC+0.020,0.084),( 0.072,HC+0.020,0.084),
           ( 0.072,HC+0.008,0.090),(-0.072,HC+0.008,0.090)], HW)
    # ears
    for sx in (-1,1):
        b.box([(sx*0.086,HC+0.020,-0.012),(sx*0.098,HC+0.020,-0.012),
               (sx*0.098,HC-0.030,-0.008),(sx*0.086,HC-0.030,-0.008),
               (sx*0.086,HC+0.016, 0.020),(sx*0.098,HC+0.016, 0.020),
               (sx*0.098,HC-0.028, 0.022),(sx*0.086,HC-0.028, 0.022)], HW)

    return b.finish()

# ------------------------------------------------------------- attachments
# Small rigid meshes parented to a bone node. Positions are bone-local.
def att_peaked_cap():
    b = MeshBuilder(skinned=False)
    r1=b.sect(0,0.148,0,0.118,0.118,2.0); r2=b.sect(0,0.223,0,0.108,0.108,2.0)
    b.stitch(r1,r2); b.cap(r2,(0,0.223,0),None); b.cap(r1,(0,0.148,0),None,flip=True)
    b.box_at(0,0.152,0.115, 0.1125,0.014,0.05)
    return ('Head', 'Trim', b.finish())

def att_flat_cap():
    b = MeshBuilder(skinned=False)
    r1=b.sect(0,0.174,0.008,0.118,0.120,2.2); r2=b.sect(0,0.206,0.002,0.086,0.090,2.2)
    b.stitch(r1,r2); b.cap(r2,(0,0.206,0.002),None); b.cap(r1,(0,0.174,0.008),None,flip=True)
    b.box_at(0,0.176,0.112, 0.075,0.009,0.030)
    return ('Head', 'Trim', b.finish())

def att_headscarf():
    b = MeshBuilder(skinned=False)
    r1=b.sect(0,0.040,0.004,0.126,0.128,2.2); r2=b.sect(0,0.150,-0.010,0.098,0.104,2.2)
    r3=b.sect(0,0.210,-0.012,0.040,0.044,2.0)
    b.stitch(r1,r2); b.stitch(r2,r3); b.cap(r3,(0,0.218,-0.012),None)
    b.box_at(0,-0.010,-0.085, 0.030,0.055,0.018)   # knot / tail at the nape
    return ('Head', 'Scarf', b.finish())

def att_collar_tab():
    b = MeshBuilder(skinned=False)
    b.box_at(0,0.055,0.128, 0.0775,0.021,0.010)
    return ('Spine2', 'State', b.finish())

def att_belt(m):
    b = MeshBuilder(skinned=False)
    r = 0.205*m['weight']*max(1.0, m['coatFlare']*0.92)
    r1=b.sect(0,-0.010,0.002,r,r*0.76,2.4); r2=b.sect(0,0.040,0.002,r*0.985,r*0.76*0.985,2.4)
    b.stitch(r1,r2)
    b.box_at(0,0.015,r*0.76+0.006, 0.030,0.020,0.008)  # buckle
    return ('Spine', 'Trim', b.finish())

ATTACHMENTS = {
    'peaked_cap': lambda m: att_peaked_cap(),
    'flat_cap':   lambda m: att_flat_cap(),
    'headscarf':  lambda m: att_headscarf(),
    'collar_tab': lambda m: att_collar_tab(),
    'belt':       lambda m: att_belt(m),
}

# --------------------------------------------------------------- animation
def q(axis,deg):
    a=math.radians(deg)/2.0; s=math.sin(a)
    v=np.array(axis,dtype=float); v/=np.linalg.norm(v)
    return [round(float(v[0]*s),5),round(float(v[1]*s),5),round(float(v[2]*s),5),round(float(math.cos(a)),5)]
def qmul(a,b):
    ax,ay,az,aw=a; bx,by,bz,bw=b
    return [round(aw*bx+ax*bw+ay*bz-az*by,5),round(aw*by-ax*bz+ay*bw+az*bx,5),
            round(aw*bz+ax*by-ay*bx+az*bw,5),round(aw*bw-ax*bx-ay*by-az*bz,5)]
HIP_Y=J['Hips'][1]

def gait(n,dur,swing,kneeMax,armSwing,elbow,lean,bob,roll):
    times=[round(i*dur/n,4) for i in range(n+1)]
    K=[2*math.pi*i/n for i in range(n+1)]
    tr={}
    hipL=[-swing*math.sin(p) for p in K]
    hipR=[-swing*math.sin(p+math.pi) for p in K]
    knL =[ 5 + kneeMax*max(0,math.sin(p-1.25*math.pi)) for p in K]
    knR =[ 5 + kneeMax*max(0,math.sin(p+math.pi-1.25*math.pi)) for p in K]
    ftL =[-0.42*hipL[i]-0.55*knL[i] for i in range(n+1)]
    ftR =[-0.42*hipR[i]-0.55*knR[i] for i in range(n+1)]
    tr['LeftUpLeg']=[q((1,0,0),v) for v in hipL]
    tr['RightUpLeg']=[q((1,0,0),v) for v in hipR]
    tr['LeftLeg']=[q((1,0,0),v) for v in knL]
    tr['RightLeg']=[q((1,0,0),v) for v in knR]
    tr['LeftFoot']=[q((1,0,0),v) for v in ftL]
    tr['RightFoot']=[q((1,0,0),v) for v in ftR]
    tr['LeftArm']=[qmul(q((0,0,1), 7),q((1,0,0), armSwing*math.sin(p))) for p in K]
    tr['RightArm']=[qmul(q((0,0,1),-7),q((1,0,0),-armSwing*math.sin(p))) for p in K]
    tr['LeftForeArm']=[q((1,0,0),-elbow-9*math.sin(p)) for p in K]
    tr['RightForeArm']=[q((1,0,0),-elbow+9*math.sin(p)) for p in K]
    tr['Spine']=[qmul(q((1,0,0),-lean*0.45),q((0,1,0), 4*math.sin(p))) for p in K]
    tr['Spine1']=[q((1,0,0),-lean*0.30) for p in K]
    tr['Spine2']=[qmul(q((1,0,0),-lean*0.25),q((0,1,0),-9*math.sin(p))) for p in K]
    tr['Neck']=[qmul(q((1,0,0),lean*0.75),q((0,1,0),4*math.sin(p))) for p in K]
    hipsT=[[0.0,round(HIP_Y-bob+bob*abs(math.cos(p)),4),0.0] for p in K]
    hipsR=[qmul(q((0,0,1),roll*math.sin(p)),q((0,1,0),-5*math.sin(p))) for p in K]
    return {'duration':times[-1],'times':times,'quat':tr,'hipsPos':hipsT,'hipsQuat':hipsR}

def idle(n=20,dur=4.4):
    times=[round(i*dur/n,4) for i in range(n+1)]
    K=[2*math.pi*i/n for i in range(n+1)]
    tr={}
    tr['Spine']=[q((1,0,0),-1.2+1.0*math.sin(k)) for k in K]
    tr['Spine2']=[q((0,1,0),1.6*math.sin(k*0.5)) for k in K]
    tr['Neck']=[q((0,1,0),3.2*math.sin(k*0.5)) for k in K]
    tr['LeftArm']=[qmul(q((0,0,1), 9),q((1,0,0),1.3*math.sin(k))) for k in K]
    tr['RightArm']=[qmul(q((0,0,1),-9),q((1,0,0),-1.3*math.sin(k))) for k in K]
    tr['LeftForeArm']=[q((1,0,0),-12) for _ in K]
    tr['RightForeArm']=[q((1,0,0),-12) for _ in K]
    tr['LeftUpLeg']=[q((1,0,0),-2) for _ in K]
    tr['RightUpLeg']=[q((1,0,0), 3) for _ in K]
    tr['LeftLeg']=[q((1,0,0),4) for _ in K]     # soft knees, correct direction
    tr['RightLeg']=[q((1,0,0),7) for _ in K]
    tr['LeftFoot']=[q((1,0,0),-2) for _ in K]
    tr['RightFoot']=[q((1,0,0),-4) for _ in K]
    hipsT=[[0.0,round(HIP_Y-0.006+0.004*math.sin(k),4),0.0] for k in K]
    hipsR=[q((0,0,1),1.4) for _ in K]
    return {'duration':times[-1],'times':times,'quat':tr,'hipsPos':hipsT,'hipsQuat':hipsR}

def crouch(n=12,dur=3.2):
    times=[round(i*dur/n,4) for i in range(n+1)]
    K=[2*math.pi*i/n for i in range(n+1)]
    tr={}
    tr['LeftUpLeg']=[q((1,0,0),-86) for _ in K]
    tr['RightUpLeg']=[q((1,0,0),-80) for _ in K]
    tr['LeftLeg']=[q((1,0,0),108) for _ in K]
    tr['RightLeg']=[q((1,0,0),102) for _ in K]
    tr['LeftFoot']=[q((1,0,0),-26) for _ in K]
    tr['RightFoot']=[q((1,0,0),-24) for _ in K]
    tr['Spine']=[q((1,0,0),-22-1.5*math.sin(k)) for k in K]
    tr['Spine1']=[q((1,0,0),-13) for _ in K]
    tr['Spine2']=[q((1,0,0),-10) for _ in K]
    tr['Neck']=[q((1,0,0),22) for _ in K]
    tr['RightArm']=[qmul(q((0,0,1),-14),q((1,0,0),-38-4*math.sin(k))) for k in K]
    tr['RightForeArm']=[q((1,0,0),-46) for _ in K]
    tr['LeftArm']=[qmul(q((0,0,1),13),q((1,0,0),-10)) for _ in K]
    tr['LeftForeArm']=[q((1,0,0),-30) for _ in K]
    hipsT=[[0.0,round(0.470+0.006*math.sin(k),4),0.0] for k in K]
    hipsR=[q((1,0,0),-7) for _ in K]
    return {'duration':times[-1],'times':times,'quat':tr,'hipsPos':hipsT,'hipsQuat':hipsR}

def apply_stoop(clip, deg):
    """Bake a permanent forward stoop into a clip. Forward spine lean is
    NEGATIVE X (see sign convention); the neck compensates upward so the
    character still looks where they are going."""
    if deg <= 0: return clip
    parts = {'Spine':-0.40,'Spine1':-0.30,'Spine2':-0.30,'Neck':0.55}
    nkeys = len(clip['times'])
    for bone, f in parts.items():
        qs = q((1,0,0), deg*f)
        if bone in clip['quat']:
            clip['quat'][bone] = [qmul(qs, qq) for qq in clip['quat'][bone]]
        else:
            clip['quat'][bone] = [qs for _ in range(nkeys)]
    return clip

# Natural-speed derivation, calibrated so the bible's base walk is exactly
# 2.05 m/s at 36° swing over 1.00s.
BASE_WALK_SPEED, BASE_SWING, BASE_DUR = 2.05, 36.0, 1.00
K_STRIDE = BASE_WALK_SPEED * BASE_DUR / math.sin(math.radians(BASE_SWING))
def walk_speed(swing, dur):
    return round(K_STRIDE * math.sin(math.radians(swing)) / dur, 3)

JOG = {'n':20,'dur':0.64,'swing':45,'knee':72,'arm':38,'elbow':32,'lean':9.0,'bob':0.042,'roll':4.5}
JOG_SPEED = 4.05   # bible-authored; jog params are unchanged from the bible clip

def build_clips(spec):
    w = spec['gait']['walk']
    stoop = spec['mesh']['stoopDeg']
    clips = {
        'idle':   idle(),
        'walk':   gait(w['n'],w['dur'],w['swing'],w['knee'],w['arm'],w['elbow'],w['lean'],w['bob'],w['roll']),
        'jog':    gait(JOG['n'],JOG['dur'],JOG['swing'],JOG['knee'],JOG['arm'],JOG['elbow'],JOG['lean'],JOG['bob'],JOG['roll']),
        'crouch': crouch(),
    }
    for c in clips.values(): apply_stoop(c, stoop)
    speeds = {'idle':0.0,'walk':walk_speed(w['swing'],w['dur']),'jog':JOG_SPEED,'crouch':0.0}
    return clips, speeds

# ------------------------------------------------------------------ export
MATERIALS = {
    'Body':  None,          # per-archetype coat colour, filled at export
    'Trim':  (0x35/255, 0x30/255, 0x1f/255),
    'State': (0xc0/255, 0x20/255, 0x1f/255),
    # Sage, not rust: under the pre-warmed lights a rust scarf saturates to
    # orange, which crowds red — and red is reserved for state authority.
    'Scarf': (0x77/255, 0x78/255, 0x5f/255),
}

def hex_to_rgb(s):
    v = int(s.lstrip('#'), 16)
    return ((v>>16&255)/255, (v>>8&255)/255, (v&255)/255)

def export_glb(path, name, spec, body, attachments, clips, speeds):
    blob = bytearray(); views, accs = [], []
    FLOAT, U16 = 5126, 5123
    ARRAY_BUF, ELEM_BUF = 34962, 34963

    def pad4():
        while len(blob) % 4: blob.append(0)

    def push(arr, dtype, comp_type, typ, target=None, minmax=False):
        pad4()
        a = np.asarray(arr, dtype=dtype)
        off = len(blob); blob.extend(a.tobytes())
        views.append(BufferView(buffer=0, byteOffset=off, byteLength=len(a.tobytes()), target=target))
        n = {'SCALAR':1,'VEC2':2,'VEC3':3,'VEC4':4,'MAT4':16}[typ]
        flat = a.reshape(-1)
        acc = Accessor(bufferView=len(views)-1, componentType=comp_type,
                       count=len(flat)//n, type=typ)
        if minmax:
            r = a.reshape(-1, n)
            acc.min = r.min(axis=0).tolist(); acc.max = r.max(axis=0).tolist()
        accs.append(acc)
        return len(accs)-1

    mat_names = ['Body','Trim','State','Scarf']
    materials = []
    for mn in mat_names:
        rgb = hex_to_rgb(spec['coats'][0]) if mn=='Body' else MATERIALS[mn]
        materials.append(Material(name=mn, pbrMetallicRoughness=PbrMetallicRoughness(
            baseColorFactor=[rgb[0],rgb[1],rgb[2],1.0], metallicFactor=0.0, roughnessFactor=1.0)))
    MI = {mn:i for i,mn in enumerate(mat_names)}

    def push_mesh(g, material, skinned):
        a_pos = push(g['position'], np.float32, FLOAT, 'VEC3', ARRAY_BUF, minmax=True)
        a_nrm = push(g['normal'],   np.float32, FLOAT, 'VEC3', ARRAY_BUF)
        a_idx = push(g['index'],    np.uint16,  U16,   'SCALAR', ELEM_BUF)
        attrs = {'POSITION':a_pos,'NORMAL':a_nrm}
        if skinned:
            attrs['JOINTS_0'] = push(g['skinIndex'], np.uint16, U16, 'VEC4', ARRAY_BUF)
            attrs['WEIGHTS_0'] = push(g['skinWeight'], np.float32, FLOAT, 'VEC4', ARRAY_BUF)
        return Mesh(primitives=[Primitive(attributes=Attributes(**attrs),
                                          indices=a_idx, mode=4, material=MI[material])])

    meshes = [push_mesh(body, 'Body', True)]

    ibm = []
    for bname in BONES:
        p = J[bname]
        m = np.eye(4, dtype=np.float32)
        m[3,0], m[3,1], m[3,2] = -p[0], -p[1], -p[2]
        ibm.append(m.flatten())
    a_ibm = push(np.concatenate(ibm), np.float32, FLOAT, 'MAT4')

    local = {}
    for bname in BONES:
        p = PARENT[bname]
        local[bname] = [round(float(x),5) for x in
                        (np.array(J[bname]) - (np.array(J[p]) if p else np.zeros(3)))]
    nodes = []
    for bname in BONES:
        nodes.append(Node(name=bname, translation=local[bname], rotation=[0,0,0,1], children=[]))
    for i, bname in enumerate(BONES):
        if PARENT[bname]: nodes[BIDX[PARENT[bname]]].children.append(i)

    mesh_node = len(nodes)
    nodes.append(Node(name='Body', mesh=0, skin=0))

    for (bone, material, g) in attachments:
        meshes.append(push_mesh(g, material, False))
        ni = len(nodes)
        nodes.append(Node(name=f'att_{material}_{ni}', mesh=len(meshes)-1))
        nodes[BIDX[bone]].children.append(ni)

    anims = []
    for cname, c in clips.items():
        samplers, channels = [], []
        a_time = push(c['times'], np.float32, FLOAT, 'SCALAR', minmax=True)
        for bone, quats in c['quat'].items():
            a_out = push(np.array(quats, dtype=np.float32).flatten(), np.float32, FLOAT, 'VEC4')
            samplers.append(AnimationSampler(input=a_time, output=a_out, interpolation='LINEAR'))
            channels.append(AnimationChannel(sampler=len(samplers)-1,
                target=AnimationChannelTarget(node=BIDX[bone], path='rotation')))
        a_hp = push(np.array(c['hipsPos'], dtype=np.float32).flatten(), np.float32, FLOAT, 'VEC3')
        samplers.append(AnimationSampler(input=a_time, output=a_hp, interpolation='LINEAR'))
        channels.append(AnimationChannel(sampler=len(samplers)-1,
            target=AnimationChannelTarget(node=BIDX['Hips'], path='translation')))
        a_hq = push(np.array(c['hipsQuat'], dtype=np.float32).flatten(), np.float32, FLOAT, 'VEC4')
        samplers.append(AnimationSampler(input=a_time, output=a_hq, interpolation='LINEAR'))
        channels.append(AnimationChannel(sampler=len(samplers)-1,
            target=AnimationChannelTarget(node=BIDX['Hips'], path='rotation')))
        anims.append(Animation(name=cname, samplers=samplers, channels=channels))

    pad4()
    g = GLTF2(
        asset=Asset(version='2.0', generator='The File — archetype generator'),
        scene=0, scenes=[Scene(nodes=[0, mesh_node])],
        nodes=nodes, meshes=meshes, materials=materials,
        skins=[Skin(inverseBindMatrices=a_ibm, joints=list(range(len(BONES))), skeleton=0)],
        animations=anims, accessors=accs, bufferViews=views,
        buffers=[Buffer(byteLength=len(blob))]
    )
    g.extras = {'archetype': name, 'naturalSpeeds': speeds}
    g.set_binary_blob(bytes(blob))
    g.save_binary(path)
    return len(blob)

# -------------------------------------------------------------------- main
def verify_knees(clips, name):
    """Positive X quaternion component = knee flexes backward. Non-negotiable."""
    for cname, c in clips.items():
        for bone in ('LeftLeg','RightLeg'):
            for qq in c['quat'][bone]:
                assert qq[0] > 0, f'{name}/{cname}/{bone}: knee flexion sign inverted'

def main():
    os.makedirs(OUT_DIR, exist_ok=True)
    total = 0
    for name, spec in ARCHETYPES.items():
        if name.startswith('_'): continue
        body = build_body(spec['mesh'])
        atts = [ATTACHMENTS[a](spec['mesh']) for a in spec['mesh']['attachments']]
        clips, speeds = build_clips(spec)
        verify_knees(clips, name)
        path = os.path.join(OUT_DIR, f'{name}.glb')
        size = export_glb(path, name, spec, body, atts, clips, speeds)
        tris = len(body['index'])//3 + sum(len(g['index'])//3 for _,_,g in atts)
        total += size
        print(f'{name:14s} tris={tris:5d} walk={speeds["walk"]:.3f} m/s '
              f'buffer={size//1024}KB -> {os.path.relpath(path, ROOT)}')
    print(f'total buffers {total//1024}KB')

if __name__ == '__main__':
    sys.exit(main())

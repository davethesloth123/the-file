"""
The File — archetype character generator.

Reads src/data/archetypes.json (the single source of truth for the cast) and
emits one GLB per archetype into public/models/. Every archetype shares the
same 25-bone Mixamo-named skeleton and the same clip set (idle / walk / jog /
crouch), so one animation library drives all of them; archetypes differ by
silhouette (shoulders, waist, weight, coat length, boots, stoop, hair,
attachments) and by walk gait.

The body is split into material groups so each figure reads at a glance:
Body (coat — per-instance colour at runtime), Skin (face, neck, hands),
Hair, Legs (trousers), Shoes/boots — plus attachment materials. An
inverted-hull outline shell (verts pushed 16mm along normals, bible §9) is
baked in as a primitive with material 'Outline'; the runtime swaps that
material for BackSide ink instead of rebuilding shells per instance.

SIGN CONVENTION (limb bones point downward, -Y):
    hip flexion   (leg swings forward) = NEGATIVE X
    knee flexion  (heel toward back)   = POSITIVE X
    elbow flexion (hand comes up)      = NEGATIVE X

Natural ground speeds are DERIVED, not invented: the bible's base walk
(36° swing over 1.00s) is defined as 2.05 m/s and every variant's speed
follows from stride geometry (speed = K·sin(swing)/duration, K calibrated to
the base walk). Jog keeps the bible's authored 4.05. Speeds are baked into
each GLB's root `extras.naturalSpeeds` so the runtime never hardcodes them.

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

OUTLINE_THICKNESS = 0.016   # bible §9

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
# Segment tiers: heads get the most silhouette, limbs the least. The
# player archetype bumps one tier via mesh.detail (camera lives behind him).
SEG = 14
SEG_HEAD, SEG_TORSO, SEG_LIMB = 22, 18, 14

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
    """Accumulates vertices plus per-material triangle groups. `skinned=False`
    builds attachment meshes with no joint data (bone-node parented).

    Rings carry their own segment count (and open/closed state, for arcs) so
    heads can be smoother than limbs. Triangles added while `set_shell(False)`
    is active are excluded from the baked outline shell — face features,
    buttons, lapels and other non-silhouette detail must not double the
    shell's cost (the shell is a silhouette read, nothing more)."""
    def __init__(self, skinned=True, material='Body'):
        self.verts, self.joints, self.weights = [], [], []
        self.groups = {}
        self.material = material
        self.skinned = skinned
        self.ring_meta = {}          # base index -> (seg, closed)
        self.shell_on = True
        self.shell_tris = []

    def set_material(self, name):
        self.material = name

    def set_shell(self, on):
        self.shell_on = on

    def _tris(self):
        return self.groups.setdefault(self.material, [])

    def _emit(self, tris):
        self._tris().extend(tris)
        if self.shell_on:
            self.shell_tris.extend(tris)

    def add_vert(self, p, bw=None):
        self.verts.append(tuple(p))
        if self.skinned:
            bw = bw or [('Hips',1.0)]
            js=[BIDX[b] for b,_ in bw][:4]; ws=[w for _,w in bw][:4]
            while len(js)<4: js.append(0); ws.append(0.0)
            s=sum(ws) or 1.0
            self.joints.append(js); self.weights.append([w/s for w in ws])
        return len(self.verts)-1

    def sect(self, cx, cy, cz, rx, rz, n=2.0, bw=None, seg=None, arc=None):
        """One superelliptical cross-section. `bw` may be a weight list or a
        per-vertex function of (x, y, z) — the greatcoat needs the latter.
        `arc=(a0_deg, a1_deg)` builds an open partial ring (seg+1 verts)."""
        seg = seg or SEG
        base=len(self.verts)
        if arc is None:
            count, closed = seg, True
            angles = [2*math.pi*i/seg for i in range(seg)]
        else:
            count, closed = seg+1, False
            a0, a1 = math.radians(arc[0]), math.radians(arc[1])
            angles = [a0+(a1-a0)*i/seg for i in range(seg+1)]
        for a in angles:
            ca,sa=math.cos(a),math.sin(a)
            x=cx+rx*math.copysign(abs(ca)**(2.0/n),ca)
            z=cz+rz*math.copysign(abs(sa)**(2.0/n),sa)
            w = bw((x,cy,z)) if callable(bw) else bw
            self.add_vert((x,cy,z), w if w else (spine_weights(cy) if self.skinned else None))
        self.ring_meta[base]=(seg, closed)
        return base

    def stitch(self, a, b):
        seg, closed = self.ring_meta[a]
        assert self.ring_meta[b][0] == seg, 'stitch: ring segment mismatch'
        tris=[]
        span = seg if closed else seg
        for i in range(span):
            j=(i+1)%seg if closed else i+1
            tris.extend([a+i,b+i,a+j, a+j,b+i,b+j])
        self._emit(tris)

    def cap(self, base, c, bw=None, flip=False):
        seg, closed = self.ring_meta[base]
        assert closed, 'cap: cannot cap an open arc'
        w = bw(c) if callable(bw) else bw
        ci=self.add_vert(c, w if w else (spine_weights(c[1]) if self.skinned else None))
        tris=[]
        for i in range(seg):
            j=(i+1)%seg
            tris.extend([ci,base+j,base+i] if flip else [ci,base+i,base+j])
        self._emit(tris)

    def loft(self, levels, bw=None, capTop=True, capBot=True, n=2.0, seg=None):
        rings=[]
        for (y,rx,rz,zo) in levels:
            rings.append(self.sect(0,y,zo,rx,rz,n,bw,seg=seg))
        for a,b in zip(rings,rings[1:]): self.stitch(a,b)
        if capBot:
            y,_,_,zo = levels[0]
            self.cap(rings[0],(0,y,zo), bw, flip=True)
        if capTop:
            y,_,_,zo = levels[-1]
            self.cap(rings[-1],(0,y,zo), bw)
        return rings

    def chain(self, pts, seg=None):
        """pts: (bone0, bone1, t, radius). Rings placed along bone segments.
        A ring exactly at t=1.0 (the joint itself) weights 50/50 across the
        joint so elbows and knees crease instead of shearing."""
        rings=[]
        for pt in pts:
            b0,b1,t,r = pt[:4]
            override = pt[4] if len(pt) > 4 else None
            p0,p1=np.array(J[b0]),np.array(J[b1])
            pos=p0+(p1-p0)*t
            if override is not None:
                bw=override
            elif t >= 0.999:
                bw=[(b0,0.5),(b1,0.5)]
            elif t<0.5:
                bw=[(b0,1.0-t*0.62),(b1,t*0.62)]
            else:
                bw=[(b0,1.0-t),(b1,t)]
            rings.append(self.sect(pos[0],pos[1],pos[2],r,r*0.92,2.0,bw,seg=seg))
        for a,b in zip(rings,rings[1:]): self.stitch(a,b)
        return rings

    def box(self, pts, bw=None):
        b=len(self.verts)
        for p in pts: self.add_vert(p, bw)
        tris=[]
        for f in [(0,1,2),(0,2,3),(4,6,5),(4,7,6),(0,4,5),(0,5,1),
                  (3,2,6),(3,6,7),(0,3,7),(0,7,4),(1,5,6),(1,6,2)]:
            tris.extend([b+f[0],b+f[1],b+f[2]])
        self._emit(tris)

    def box_at(self, cx,cy,cz, hw,hh,hd, bw=None):
        self.box([(cx-hw,cy+hh,cz-hd),(cx+hw,cy+hh,cz-hd),(cx+hw,cy-hh,cz-hd),(cx-hw,cy-hh,cz-hd),
                  (cx-hw,cy+hh,cz+hd),(cx+hw,cy+hh,cz+hd),(cx+hw,cy-hh,cz+hd),(cx-hw,cy-hh,cz+hd)], bw)

    def ellipsoid(self, cx, cy, cz, rx, ry, rz, bw=None, seg_u=12, seg_v=6):
        """Low-cost UV ellipsoid for anatomy that must read as organic.
        The poles are shared and intermediate latitude rings are stitched;
        face details can opt out of the silhouette shell via set_shell()."""
        top = self.add_vert((cx, cy+ry, cz), bw)
        rings = []
        for j in range(1, seg_v):
            phi = math.pi*j/seg_v
            base = len(self.verts)
            for i in range(seg_u):
                theta = 2*math.pi*i/seg_u
                self.add_vert((
                    cx + rx*math.sin(phi)*math.cos(theta),
                    cy + ry*math.cos(phi),
                    cz + rz*math.sin(phi)*math.sin(theta),
                ), bw)
            self.ring_meta[base] = (seg_u, True)
            rings.append(base)
        bottom = self.add_vert((cx, cy-ry, cz), bw)
        tris = []
        for i in range(seg_u):
            ni = (i+1) % seg_u
            tris.extend([top, rings[0]+i, rings[0]+ni])
        self._emit(tris)
        for a, bb in zip(rings, rings[1:]):
            self.stitch(a, bb)
        tris = []
        for i in range(seg_u):
            ni = (i+1) % seg_u
            tris.extend([bottom, rings[-1]+ni, rings[-1]+i])
        self._emit(tris)

    def finish(self):
        verts=np.array(self.verts,dtype=np.float32)
        all_tris=np.array([i for g in self.groups.values() for i in g],dtype=np.uint32)
        norms=np.zeros_like(verts)
        f=all_tris.reshape(-1,3)
        fn=np.cross(verts[f[:,1]]-verts[f[:,0]], verts[f[:,2]]-verts[f[:,0]])
        for i in range(3): np.add.at(norms,f[:,i],fn)
        ln=np.linalg.norm(norms,axis=1,keepdims=True); ln[ln==0]=1
        norms/=ln
        out={'position':verts,'normal':norms,
             'groups':{k:np.array(v,dtype=np.uint16) for k,v in self.groups.items()},
             'shell':np.array(self.shell_tris,dtype=np.uint16)}
        if self.skinned:
            out['skinIndex']=np.array(self.joints,dtype=np.uint16)
            out['skinWeight']=np.array(self.weights,dtype=np.float32)
        return out

# ------------------------------------------------------------------- body
def smoothstep(e0, e1, x):
    t = max(0.0, min(1.0, (x-e0)/max(e1-e0, 1e-9)))
    return t*t*(3-2*t)

def seg_tiers(m):
    """Player gets one tier more everywhere — the camera lives behind him."""
    if m.get('detail', 1.0) > 1.15:
        return 26, 22, 16
    return SEG_HEAD, SEG_TORSO, SEG_LIMB

def build_body(m):
    """m: mesh params from archetypes.json."""
    shoulder, waist, weight = m['shoulder'], m['waist'], m['weight']
    limb = m['limb']
    face = m.get('face', {})
    fJaw, fBrow = face.get('jaw',1.0), face.get('brow',1.0)
    fNose, fCheek = face.get('nose',1.0), face.get('cheek',1.0)
    coat = m.get('coat', {})
    sH, sT, sL = seg_tiers(m)
    b = MeshBuilder()

    def tf(y):
        """Torso width multiplier: hips → waist → shoulder blend by height."""
        if y < 1.02: f = 1.0
        elif y < 1.16: f = waist
        elif y > 1.30: f = shoulder
        else: f = waist + (shoulder-waist)*(y-1.16)/(1.30-1.16)
        return f * weight

    def torso_w(p):
        """Spine weights, blended toward Shoulder+Arm at the shoulder line so
        the coat's shoulders follow arm swing instead of shearing off it."""
        x, y, _ = p
        base = spine_weights(y)
        if 1.30 <= y <= 1.458:
            f = smoothstep(0.105, 0.185, abs(x)) * 0.55
            if f > 0.001:
                side = 'Left' if x >= 0 else 'Right'
                out = [(bn, w*(1.0-f)) for bn, w in base]
                out += [(f'{side}Shoulder', f*0.4), (f'{side}Arm', f*0.6)]
                return out[:4]
        return base

    TORSO_BODY = [
        (0.855, 0.163, 0.122, 0.000),
        (0.930, 0.170, 0.126, 0.000),
        (1.010, 0.152, 0.114, 0.002),
        (1.070, 0.143, 0.107, 0.004),   # waist
        (1.150, 0.158, 0.117, 0.004),
        (1.235, 0.180, 0.130, 0.002),   # ribcage
        (1.320, 0.194, 0.129, 0.000),   # chest
        (1.395, 0.188, 0.117,-0.002),   # shoulder line
        (1.445, 0.116, 0.098,-0.004),   # trapezius — collar line
    ]
    TORSO_NECK = [
        (1.445, 0.116, 0.098,-0.004),
        (1.490, 0.061, 0.060,-0.004),
        (1.545, 0.056, 0.057,-0.002),
    ]
    b.set_material('Body')
    b.loft([(y, rx*tf(y), rz*weight, zo) for (y,rx,rz,zo) in TORSO_BODY], bw=torso_w, n=2.6, seg=sT)
    b.set_material('Skin')
    b.loft([(y, rx*tf(y), rz*weight, zo) for (y,rx,rz,zo) in TORSO_NECK], n=2.6, capBot=False, seg=sT)

    # -- coat, lofted from hem to collar. Below the hip line the hem is
    # part-weighted to the near-side UpLeg so a long coat swings with the
    # stride instead of having thighs punch through it.
    hem, flare = m['coatHem'], m['coatFlare']
    def coat_w(p):
        x, y, _ = p
        if y >= 0.955: return torso_w(p)
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
    NL = 6 if hem < 0.70 else 4
    for i in range(NL):
        t = (i/(NL-1))**0.8   # eased: the skirt bells instead of coning
        y = hem + (0.960-hem)*(i/(NL-1))
        rx = hem_rx + (0.199-hem_rx)*t
        rz = hem_rz + (0.152-hem_rz)*t
        lower.append((y, rx, rz, 0.0))
    COAT = lower + top
    b.set_material('Body')
    b.loft([(y, rx*(tf(y) if y>1.0 else weight), rz*weight, zo) for (y,rx,rz,zo) in COAT],
           bw=coat_w, capTop=False, n=2.7, seg=sT)

    # -- tailoring: collar, lapels, button placket, pocket flaps. None of it
    # is silhouette, so most of it stays out of the outline shell.
    def coat_front_z(y):
        pts = [(hem, hem_rz), (0.960, 0.152), (1.060, 0.135), (1.170, 0.140),
               (1.270, 0.148), (1.370, 0.137), (1.452, 0.104)]
        for (y0,r0),(y1,r1) in zip(pts, pts[1:]):
            if y0 <= y <= y1:
                t=(y-y0)/max(y1-y0,1e-9); return (r0+(r1-r0)*t)*weight
        return 0.14*weight

    if coat.get('collar'):
        colW = [('Spine2',0.7),('Neck',0.3)]
        r0 = 0.118*weight
        if coat['collar'] == 'stand':
            lv = [(1.448, r0*1.14, r0*1.06), (1.508, r0*1.10, r0*1.02)]
        else:  # fold — wider at the base, rolled in at the top
            lv = [(1.446, r0*1.34, r0*1.24), (1.494, r0*1.12, r0*1.06)]
        rings=[]
        for (y,rx,rz) in lv:
            rings.append((b.sect(0,y,-0.004,rx,rz,2.3,colW,seg=12,arc=(115,425)),
                          b.sect(0,y,-0.004,rx-0.015,rz-0.015,2.3,colW,seg=12,arc=(115,425))))
        b.stitch(rings[0][0], rings[1][0])      # outer face (silhouette: keep)
        b.set_shell(False)
        b.stitch(rings[1][1], rings[0][1])      # inner face, reversed
        b.stitch(rings[1][0], rings[1][1])      # top rim
        b.set_shell(True)

    b.set_shell(False)
    if coat.get('lapels'):
        for sx in (-1, 1):
            zf = coat_front_z(1.40)
            b.box([(sx*0.084,1.432,zf-0.020),(sx*0.020,1.408,zf+0.006),
                   (sx*0.020,1.300,zf+0.014),(sx*0.086,1.318,zf-0.012),
                   (sx*0.080,1.428,zf-0.028),(sx*0.016,1.404,zf-0.002),
                   (sx*0.016,1.296,zf+0.006),(sx*0.082,1.314,zf-0.020)],
                  [('Spine2',1.0)])
    nBtn = int(coat.get('buttons', 0))
    if nBtn > 0:
        cols = [-0.046, 0.046] if coat.get('doubleBreasted') else [0.0]
        if not coat.get('doubleBreasted'):
            # single-breasted: a raised placket strip under the buttons
            b.set_material('Body')
            b.box_at(0.011, 1.20, coat_front_z(1.20)+0.004, 0.013, 0.195, 0.006,
                     [('Spine1',0.6),('Spine2',0.4)])
        b.set_material('Trim')
        for k in range(nBtn):
            by = 1.335 - k*(0.315/max(nBtn-1,1))
            for bx in cols:
                b.box_at(bx, by, coat_front_z(by)+0.008, 0.011, 0.011, 0.005,
                         [('Spine1',0.5),('Spine',0.5)])
    # hip pocket flaps
    b.set_material('Body')
    for sx in (-1, 1):
        b.box_at(sx*0.118, 0.992, coat_front_z(0.992)*0.86, 0.050, 0.016, 0.008,
                 [('Hips',1.0)])
    b.set_shell(True)

    # -- limbs
    boots = m['boots']
    cuffs = coat.get('cuffs', False)
    for s in ('Left','Right'):
        b.set_material('Body')   # sleeves: deltoid mass, creased elbow, wrist
        sleeve=[(f'{s}Arm',f'{s}ForeArm',0.00,0.086*limb*shoulder,
                    [(f'{s}Shoulder',0.35),(f'{s}Arm',0.65)]),
                (f'{s}Arm',f'{s}ForeArm',0.08,0.080*limb),
                (f'{s}Arm',f'{s}ForeArm',0.22,0.068*limb),
                (f'{s}Arm',f'{s}ForeArm',0.60,0.058*limb),
                (f'{s}Arm',f'{s}ForeArm',1.00,0.054*limb),
                (f'{s}ForeArm',f'{s}Hand',0.35,0.054*limb),
                (f'{s}ForeArm',f'{s}Hand',0.68,0.045*limb)]
        if cuffs:
            sleeve += [(f'{s}ForeArm',f'{s}Hand',0.82,0.050*limb),
                       (f'{s}ForeArm',f'{s}Hand',1.00,0.048*limb)]
        else:
            sleeve += [(f'{s}ForeArm',f'{s}Hand',1.00,0.037*limb)]
        r=b.chain(sleeve, seg=sL)
        b.cap(r[0], tuple(np.array(J[f'{s}Arm'])+np.array([0,0.03,0])), [(f'{s}Arm',1.0)])
        b.cap(r[-1], tuple(np.array(J[f'{s}Hand'])+np.array([0,0.012,0])),
              [(f'{s}Hand',1.0)], flip=True)

        # Hands: a shaped palm, four separate fingers and a two-section
        # thumb. The old mitten silhouette was one of the strongest prototype
        # tells at third-person camera distance.
        b.set_material('Skin')
        hp=np.array(J[f'{s}Hand'])
        HB=[(f'{s}Hand',1.0)]
        p1=b.sect(hp[0],hp[1]-0.008,0.006,0.038,0.019,3.0,HB,seg=12)
        p2=b.sect(hp[0],hp[1]-0.044,0.011,0.044,0.021,3.0,HB,seg=12)
        p3=b.sect(hp[0],hp[1]-0.074,0.014,0.041,0.019,2.8,HB,seg=12)
        b.stitch(p1,p2); b.stitch(p2,p3)
        b.cap(p1,(hp[0],hp[1]-0.006,0.006),HB,flip=True)
        finger_lengths = [0.036, 0.045, 0.048, 0.040]
        finger_x = [-0.029, -0.010, 0.010, 0.029]
        for fx, fl in zip(finger_x, finger_lengths):
            r0=b.sect(hp[0]+fx,hp[1]-0.073,0.014,0.0086,0.0080,2.2,HB,seg=7)
            r1=b.sect(hp[0]+fx,hp[1]-0.073-fl*0.62,0.016,0.0081,0.0075,2.2,HB,seg=7)
            r2=b.sect(hp[0]+fx,hp[1]-0.073-fl,0.017,0.0067,0.0064,2.0,HB,seg=7)
            b.stitch(r0,r1); b.stitch(r1,r2)
            b.cap(r2,(hp[0]+fx,hp[1]-0.075-fl,0.017),HB)
        b.set_shell(False)
        sx = 1 if s=='Left' else -1
        t1=b.sect(hp[0]-sx*0.038,hp[1]-0.026,0.018,0.013,0.012,2.0,HB,seg=7)
        t2=b.sect(hp[0]-sx*0.050,hp[1]-0.047,0.030,0.011,0.010,2.0,HB,seg=7)
        t3=b.sect(hp[0]-sx*0.054,hp[1]-0.064,0.039,0.0085,0.008,2.0,HB,seg=7)
        b.stitch(t1,t2); b.stitch(t2,t3)
        b.cap(t3,(hp[0]-sx*0.056,hp[1]-0.071,0.043),HB)
        b.set_shell(True)

        # legs: trousers with calf mass and an ankle break, then footwear
        b.set_material('Legs')
        thigh=[(f'{s}UpLeg',f'{s}Leg',0.00,0.108*limb),
               (f'{s}UpLeg',f'{s}Leg',0.28,0.098*limb),
               (f'{s}UpLeg',f'{s}Leg',0.70,0.080*limb),
               (f'{s}UpLeg',f'{s}Leg',1.00,0.070*limb)]
        if not boots:
            thigh += [(f'{s}Leg',f'{s}Foot',0.30,0.079*limb),
                      (f'{s}Leg',f'{s}Foot',0.62,0.062*limb),
                      (f'{s}Leg',f'{s}Foot',0.88,0.056*limb)]
        lr=b.chain(thigh, seg=sL)
        b.cap(lr[0], tuple(np.array(J[f'{s}UpLeg'])+np.array([0,0.05,0])), [(f'{s}UpLeg',1.0)])
        b.set_material('Shoes')
        if boots:
            # knee-high shaft: fold-over top, curved calf, ankle
            low=b.chain([(f'{s}UpLeg',f'{s}Leg',1.00,0.078*limb),
                         (f'{s}UpLeg',f'{s}Leg',1.00,0.070*limb),
                         (f'{s}Leg',f'{s}Foot',0.16,0.078),
                         (f'{s}Leg',f'{s}Foot',0.42,0.072),
                         (f'{s}Leg',f'{s}Foot',0.70,0.062),
                         (f'{s}Leg',f'{s}Foot',1.00,0.058)], seg=sL)
        else:
            low=b.chain([(f'{s}Leg',f'{s}Foot',0.88,0.050*limb),
                         (f'{s}Leg',f'{s}Foot',1.00,0.044*limb)], seg=sL)
        fp=np.array(J[f'{s}Foot'])
        k = 1.10 if boots else 1.0
        FB=[(f'{s}Foot',1.0)]
        s1=b.sect(fp[0],fp[1]-0.012,0.010,0.049*k,0.052*k,2.6,FB,seg=sL)
        s2=b.sect(fp[0],fp[1]-0.048,0.045,0.052*k,0.088*k,3.0,FB,seg=sL)
        s3=b.sect(fp[0],fp[1]-0.058,0.105,0.046*k,0.058*k,3.0,FB,seg=sL)
        b.stitch(low[-1],s1); b.stitch(s1,s2); b.stitch(s2,s3)
        b.cap(s3,(fp[0],fp[1]-0.060,0.140),FB)
        b.cap(s2,(fp[0],fp[1]-0.062,0.045),FB,flip=True)
        # heel block — 12 triangles that change the whole standing profile
        b.box_at(fp[0],fp[1]-0.052,-0.028, 0.042*k,0.022,0.032, FB)

    # -- head: a proper skull — long front-to-back, temple width, cheekbone
    # step, distinct jaw corner, forward chin. Per-archetype face multipliers
    # (jaw/brow/nose/cheek) come from archetypes.json.
    HC = J['Head'][1] + 0.082
    HW = [('Head',1.0)]
    b.set_material('Skin')
    HEAD = [
        (HC+0.122, 0.040, 0.048,-0.008),
        (HC+0.104, 0.072, 0.084,-0.010),                   # skull top
        (HC+0.076, 0.088, 0.100,-0.013),                   # occiput — long skull
        (HC+0.042, 0.093*fBrow, 0.104,-0.009),             # temple
        (HC+0.014, 0.092*fBrow, 0.103,-0.002),             # brow
        (HC-0.012, 0.086, 0.096, 0.002),                   # eye line, pinched
        (HC-0.030, 0.079+0.008*fCheek, 0.095, 0.004),      # cheekbone
        (HC-0.048, 0.074*fCheek, 0.089, 0.005),            # cheek hollow
        (HC-0.062, 0.068*fJaw, 0.081, 0.006),              # jaw corner
        (HC-0.078, 0.056*fJaw, 0.071, 0.009),              # jawline
        (HC-0.094, 0.039*fJaw, 0.052, 0.014),              # chin
        (HC-0.106, 0.024, 0.036, 0.010),                   # chin tip
        (HC-0.120, 0.038, 0.046,-0.002),                   # under-jaw
        (HC-0.140, 0.050, 0.052,-0.005),                   # throat
        (HC-0.165, 0.056, 0.057,-0.006),                   # into the neck loft
    ]
    # loft() expects ascending Y. Keeping this list in anatomical top-down
    # order is useful for editing, but it must be reversed for outward face
    # normals; otherwise the inverted-hull outline renders across the face.
    b.loft(list(reversed(HEAD)), bw=lambda p: HW, n=2.3, seg=sH)
    # nose: bridge wedge plus a slightly wider tip — kept in the shell, the
    # profile silhouette is half the face at this style level
    ns = fNose
    b.box([(-0.014,HC+0.012,0.088),( 0.014,HC+0.012,0.088),
           ( 0.012,HC-0.020,0.094),(-0.012,HC-0.020,0.094),
           (-0.008,HC+0.008,0.100),( 0.008,HC+0.008,0.100),
           ( 0.008,HC-0.018,0.106*ns),(-0.008,HC-0.018,0.106*ns)], HW)
    b.box([(-0.013,HC-0.018,0.092),( 0.013,HC-0.018,0.092),
           ( 0.015,HC-0.040,0.092),(-0.015,HC-0.040,0.092),
           (-0.009,HC-0.020,0.112*ns),( 0.009,HC-0.020,0.112*ns),
           ( 0.011,HC-0.038,0.120*ns),(-0.011,HC-0.038,0.120*ns)], HW)
    b.set_shell(False)
    # brow ridge — a shallow shelf reads as a face under toon shading
    b.box([(-0.078,HC+0.026,0.070),( 0.078,HC+0.026,0.070),
           ( 0.078,HC+0.014,0.078),(-0.078,HC+0.014,0.078),
           (-0.072,HC+0.020,0.084),( 0.072,HC+0.020,0.084),
           ( 0.072,HC+0.008,0.090),(-0.072,HC+0.008,0.090)], HW)
    b.set_shell(True)
    # Ears: shallow organic shells rather than rectangular tabs.
    for sx in (-1,1):
        b.ellipsoid(sx*0.094,HC-0.006,0.002,0.012,0.030,0.010,HW,seg_u=9,seg_v=5)

    # -- face features. Whites, irises, brows, lips and nostrils remain cheap,
    # but read as a human face instead of a pair of black prototype slots.
    b.set_shell(False)
    eye_sep = 0.033
    b.set_material('EyeWhite')
    for sx in (-1,1):
        b.ellipsoid(sx*eye_sep, HC-0.012, 0.096, 0.018,0.0085,0.010,HW,seg_u=10,seg_v=5)
    b.set_material('Iris')
    for sx in (-1,1):
        b.ellipsoid(sx*eye_sep, HC-0.012, 0.104, 0.0062,0.0062,0.0035,HW,seg_u=8,seg_v=4)
        b.ellipsoid(sx*eye_sep, HC-0.012, 0.107, 0.0027,0.0034,0.002,HW,seg_u=7,seg_v=4)
    b.set_material('Hair')
    for sx in (-1,1):
        b.box([(sx*0.012,HC+0.010,0.099),(sx*0.055,HC+0.013,0.096),
               (sx*0.054,HC+0.020,0.095),(sx*0.014,HC+0.019,0.099),
               (sx*0.012,HC+0.010,0.104),(sx*0.055,HC+0.013,0.101),
               (sx*0.054,HC+0.020,0.100),(sx*0.014,HC+0.019,0.104)],HW)
    b.set_material('Iris')
    for sx in (-1,1):
        b.ellipsoid(sx*0.009,HC-0.039,0.117*ns,0.0034,0.0025,0.0025,HW,seg_u=7,seg_v=4)
    b.set_material('Lips')
    mouth_w = 0.034*(0.95+0.05*fJaw)
    b.ellipsoid(0,HC-0.066,0.091,mouth_w,0.0048,0.006,HW,seg_u=12,seg_v=4)
    b.ellipsoid(0,HC-0.073,0.090,mouth_w*0.88,0.0042,0.0055,HW,seg_u=12,seg_v=4)
    b.set_material('SkinDetail')
    for sx in (-1,1):
        b.ellipsoid(sx*0.094,HC-0.006,0.011,0.003,0.013,0.0025,HW,seg_u=7,seg_v=4)
    if m.get('moustache'):
        b.set_material('Hair')
        b.box_at(0, HC-0.052, 0.096, 0.032, 0.009, 0.014, HW)
    b.set_shell(True)
    if m.get('beard'):
        b.set_material('Hair')
        b.box_at(0, HC-0.104, 0.048, 0.048, 0.042, 0.046, HW)
        b.box_at(0, HC-0.070, 0.076, 0.036, 0.020, 0.022, HW)   # up the jaw

    # -- hair: a cap slightly proud of the skull, pulled back so the face
    # stays clear; 'ring' leaves the crown bald.
    if m.get('hair') == 'full':
        b.set_material('Hair')
        b.loft([(HC+0.006, 0.091, 0.096,-0.032),
                (HC+0.030, 0.096, 0.106,-0.022),
                (HC+0.072, 0.092, 0.103,-0.018),
                (HC+0.110, 0.078, 0.088,-0.016),
                (HC+0.132, 0.055, 0.062,-0.014)],
               bw=lambda p: HW, n=2.3, capBot=True, capTop=True, seg=sH)
    elif m.get('hair') == 'ring':
        b.set_material('Hair')
        b.loft([(HC-0.058, 0.088, 0.092,-0.024),
                (HC-0.012, 0.096, 0.102,-0.016),
                (HC+0.022, 0.094, 0.100,-0.012)],
               bw=lambda p: HW, n=2.3, capBot=False, capTop=False, seg=sH)

    return b.finish()

# ------------------------------------------------------------- attachments
# Small rigid meshes parented to a bone node; each part carries its own
# material. Positions are bone-local. Returns [(bone, material, geom), ...].
def att_peaked_cap(m):
    # High Soviet crown with the saucer overhang, red band, curved visor.
    crown = MeshBuilder(skinned=False)
    r1=crown.sect(0,0.158,0,0.118,0.118,2.0,seg=16)
    r2=crown.sect(0,0.215,0.012,0.126,0.121,2.0,seg=16)
    r3=crown.sect(0,0.250,0.020,0.116,0.108,2.0,seg=16)
    crown.stitch(r1,r2); crown.stitch(r2,r3); crown.cap(r3,(0,0.252,0.020))
    band = MeshBuilder(skinned=False)
    b1=band.sect(0,0.134,0,0.1215,0.1215,2.0,seg=16)
    b2=band.sect(0,0.158,0,0.1190,0.1190,2.0,seg=16)
    band.stitch(b1,b2)
    # curved lacquered visor: two concentric arcs, dropped at the outer lip
    brim = MeshBuilder(skinned=False)
    vi=brim.sect(0,0.142,0.004,0.116,0.116,2.0,seg=10,arc=(24,156))
    vo=brim.sect(0,0.120,0.004,0.176,0.176,2.0,seg=10,arc=(24,156))
    brim.stitch(vi,vo)          # top face
    vi2=brim.sect(0,0.136,0.004,0.116,0.116,2.0,seg=10,arc=(24,156))
    vo2=brim.sect(0,0.114,0.004,0.176,0.176,2.0,seg=10,arc=(24,156))
    brim.stitch(vo2,vi2)        # underside, reversed winding
    return [('Head','MilitiaCloth',crown.finish()),
            ('Head','State',band.finish()),
            ('Head','Trim',brim.finish())]

def att_shoulder_boards(m):
    out = []
    for side in ('Left','Right'):
        b = MeshBuilder(skinned=False, material='Boards')
        sx = 1 if side == 'Left' else -1
        b.box_at(sx*0.075, 0.022, 0.0, 0.062, 0.009, 0.034)
        out.append((f'{side}Shoulder','Boards',b.finish()))
    return out

def att_muffler(m):
    b = MeshBuilder(skinned=False, material='Muffler')
    r1=b.sect(0,-0.005,0.006,0.082,0.078,2.3); r2=b.sect(0,0.042,0.002,0.072,0.070,2.3)
    b.stitch(r1,r2)
    b.box_at(0.028,-0.085,0.088, 0.036,0.070,0.013)   # tail down the chest
    return [('Neck','Muffler',b.finish())]

def att_flat_cap(m):
    # kepka: crown fallen forward onto a short curved brim
    b = MeshBuilder(skinned=False, material='CapCloth')
    r1=b.sect(0,0.172,0.006,0.120,0.122,2.2,seg=16)
    r2=b.sect(0,0.204,0.030,0.096,0.098,2.2,seg=16)
    b.stitch(r1,r2); b.cap(r2,(0,0.208,0.034)); b.cap(r1,(0,0.172,0.006),flip=True)
    vi=b.sect(0,0.170,0.006,0.112,0.112,2.0,seg=8,arc=(38,142))
    vo=b.sect(0,0.158,0.006,0.156,0.156,2.0,seg=8,arc=(38,142))
    b.stitch(vi,vo)
    vi2=b.sect(0,0.165,0.006,0.112,0.112,2.0,seg=8,arc=(38,142))
    vo2=b.sect(0,0.153,0.006,0.156,0.156,2.0,seg=8,arc=(38,142))
    b.stitch(vo2,vi2)
    return [('Head','CapCloth',b.finish())]

def att_headscarf(m):
    b = MeshBuilder(skinned=False, material='Scarf')
    # Open from temple to temple: the previous closed rings formed a veil
    # across the eyes. This hood wraps the sides and nape while a shallow
    # crown sits behind the forehead plane.
    r1=b.sect(0,0.030,-0.012,0.126,0.124,2.2,seg=14,arc=(150,390))
    r2=b.sect(0,0.128,-0.020,0.110,0.112,2.2,seg=14,arc=(150,390))
    r3=b.sect(0,0.188,-0.028,0.066,0.072,2.0,seg=14,arc=(150,390))
    b.stitch(r1,r2); b.stitch(r2,r3)
    b.ellipsoid(0,0.154,-0.030,0.100,0.074,0.090,seg_u=14,seg_v=6)
    b.box_at(0,-0.010,-0.085, 0.030,0.055,0.018)   # knot / tail at the nape
    return [('Head','Scarf',b.finish())]

def att_collar_tab(m):
    b = MeshBuilder(skinned=False, material='State')
    b.box_at(-0.048,0.055,0.126, 0.034,0.021,0.010)
    b.box_at( 0.048,0.055,0.126, 0.034,0.021,0.010)
    return [('Spine2','State',b.finish())]

def att_belt(m):
    b = MeshBuilder(skinned=False, material='Trim')
    r = 0.205*m['weight']*max(1.0, m['coatFlare']*0.92)
    r1=b.sect(0,-0.010,0.002,r,r*0.76,2.4); r2=b.sect(0,0.040,0.002,r*0.985,r*0.76*0.985,2.4)
    b.stitch(r1,r2)
    b.box_at(0,0.015,r*0.76+0.006, 0.030,0.020,0.008)  # buckle
    return [('Spine','Trim',b.finish())]

def att_cane(m):
    b = MeshBuilder(skinned=False, material='Trim')
    r1=b.sect(0,-0.020,0.010,0.015,0.015,2.0); r2=b.sect(0,-0.800,0.055,0.011,0.011,2.0)
    b.stitch(r1,r2); b.cap(r1,(0,-0.014,0.010)); b.cap(r2,(0,-0.804,0.055),flip=True)
    b.box_at(0,-0.016,0.036, 0.012,0.012,0.036)   # short crook forward
    return [('RightHand','Trim',b.finish())]

def att_handbag(m):
    b = MeshBuilder(skinned=False, material='Trim')
    b.box_at(0,-0.175,0.012, 0.078,0.062,0.030)
    b.box_at(0,-0.118,0.012, 0.046,0.020,0.007)   # handle up to the fist
    return [('LeftHand','Trim',b.finish())]

ATTACHMENTS = {
    'peaked_cap': att_peaked_cap,
    'flat_cap':   att_flat_cap,
    'headscarf':  att_headscarf,
    'collar_tab': att_collar_tab,
    'belt':       att_belt,
    'cane':       att_cane,
    'handbag':    att_handbag,
    'shoulder_boards': att_shoulder_boards,
    'muffler':    att_muffler,
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

def bump(p, center, width, amp):
    """Raised-cosine window on cycle phase, wrap-aware. Zero outside width."""
    d = math.atan2(math.sin(p-center), math.cos(p-center))
    if abs(d) > width: return 0.0
    return amp * 0.5 * (1.0 + math.cos(math.pi*d/width))

def gait(P):
    """One walking/jogging cycle from a params dict (defaults merged from
    archetypes.json _gaitDefaults). Left heel strike is at p = pi/2 — the
    phase where the left hip is most forward. Sign conventions (CLAUDE.md,
    limb bones point -Y): hip forward = NEGATIVE X; knee flexion = POSITIVE
    X; elbow flexion = NEGATIVE X. The foot bone runs toward +Z, so toe-off
    plantarflexion = POSITIVE X and heel-strike dorsiflexion = NEGATIVE X."""
    n, dur = P['n'], P['dur']
    swing, kneeMax = P['swing'], P['knee']
    armSwing, elbowBase = P['arm'], P['elbow']
    lean, bob, roll = P['lean'], P['bob'], P['roll']
    elbowSwing  = P.get('elbowSwing', 9)
    armZ        = P.get('armZ', 7)
    sway        = P.get('sway', 0.014)
    pelvisYaw   = P.get('pelvisYaw', 5)
    shoulderYaw = P.get('shoulderYaw', 9)
    headStab    = P.get('headStab', 1.0)
    lift        = P.get('lift', 0)
    foot        = P.get('foot', {})
    fHeel   = foot.get('heel', 10)
    fToe    = foot.get('toe', 18)
    fClear  = foot.get('clear', 6)
    fFlat   = foot.get('flatten', 0.5)
    PI = math.pi
    times=[round(i*dur/n,4) for i in range(n+1)]
    K=[2*PI*i/n for i in range(n+1)]
    tr={}
    hipL=[-swing*math.sin(p) for p in K]
    hipR=[-swing*math.sin(p+PI) for p in K]
    knL =[ 5 + kneeMax*max(0,math.sin(p-1.25*PI)) + lift*max(0,math.sin(p-0.9*PI)) for p in K]
    knR =[ 5 + kneeMax*max(0,math.sin(p+PI-1.25*PI)) + lift*max(0,math.sin(p+PI-0.9*PI)) for p in K]
    # foot rocker: flatten against the ground through stance, dorsiflex into
    # the heel strike, plantarflex at toe-off, lift toes through the swing
    def foot_curve(p, hip, knee):
        return (-(hip*0.42 + knee*0.55) * fFlat/0.55
                + bump(p, 0.50*PI, 0.85, -fHeel)
                + bump(p, 1.42*PI, 0.95,  fToe)
                + bump(p, 1.85*PI, 0.70, -fClear))
    ftL=[foot_curve(K[i], hipL[i], knL[i]) for i in range(n+1)]
    ftR=[foot_curve(K[i]+PI, hipR[i], knR[i]) for i in range(n+1)]  # bump() wraps
    tr['LeftUpLeg']=[q((1,0,0),v) for v in hipL]
    tr['RightUpLeg']=[q((1,0,0),v) for v in hipR]
    tr['LeftLeg']=[q((1,0,0),v) for v in knL]
    tr['RightLeg']=[q((1,0,0),v) for v in knR]
    tr['LeftFoot']=[q((1,0,0),v) for v in ftL]
    tr['RightFoot']=[q((1,0,0),v) for v in ftR]
    # arms: swing opposite the same-side leg; the forearm flexes MORE as the
    # arm swings forward (a straight pumping arm reads robotic)
    tr['LeftArm']=[qmul(q((0,0,1), armZ),q((1,0,0), armSwing*math.sin(p))) for p in K]
    tr['RightArm']=[qmul(q((0,0,1),-armZ),q((1,0,0),-armSwing*math.sin(p))) for p in K]
    tr['LeftForeArm']=[q((1,0,0),-(elbowBase+elbowSwing*max(0,-math.sin(p)))) for p in K]
    tr['RightForeArm']=[q((1,0,0),-(elbowBase+elbowSwing*max(0, math.sin(p)))) for p in K]
    # counter-rotation: pelvis one way, shoulders the other, neck unwinds
    # what remains so the head stays on target (headStab 1 = fully steady)
    headYaw = (-0.6*pelvisYaw + shoulderYaw) * headStab
    tr['Spine']=[qmul(q((1,0,0),-lean*0.45),q((0,1,0), pelvisYaw*0.4*math.sin(p))) for p in K]
    tr['Spine1']=[q((1,0,0),-lean*0.30) for p in K]
    tr['Spine2']=[qmul(q((1,0,0),-lean*0.25),q((0,1,0), shoulderYaw*math.sin(p))) for p in K]
    tr['Neck']=[qmul(q((1,0,0),lean*0.75),q((0,1,0),-headYaw*math.sin(p))) for p in K]
    hipsT=[[round(sway*math.sin(p),4),round(HIP_Y-bob+bob*abs(math.cos(p)),4),0.0] for p in K]
    hipsR=[qmul(q((0,0,1),roll*math.sin(p)),q((0,1,0),-pelvisYaw*math.sin(p))) for p in K]
    return {'duration':times[-1],'times':times,'quat':tr,'hipsPos':hipsT,'hipsQuat':hipsR}

def idle(P=None, n=64, dur=8.0):
    """Two breath cycles, one weight shift out and back, one glance. The
    militia variant clasps hands behind the back and scans instead."""
    P = P or {}
    breath  = P.get('breath', 1.1)
    shZ     = P.get('shoulderZ', 1.3)
    shiftX  = P.get('shiftX', 0.020)
    glance  = P.get('glanceDeg', 14)
    behind  = P.get('armsBehind', False)
    PI = math.pi
    times=[round(i*dur/n,4) for i in range(n+1)]
    K=[2*PI*i/n for i in range(n+1)]
    # weight shift: eased swap to the mirrored stance at mid-loop, back at wrap
    def sh(k):
        return smoothstep(0.9*PI, 1.1*PI, k) - smoothstep(1.9*PI, 2.0*PI, k)
    def mixv(a, b, t): return a + (b-a)*t
    tr={}
    tr['Spine']=[q((1,0,0),-1.2+breath*math.sin(2*k)) for k in K]
    tr['Spine2']=[q((0,1,0),1.6*math.sin(k*0.5)) for k in K]
    if behind:
        tr['Neck']=[q((0,1,0),8*math.sin(k)) for k in K]            # slow scan
        tr['LeftArm']=[qmul(q((0,0,1), 12),q((1,0,0), 16)) for _ in K]
        tr['RightArm']=[qmul(q((0,0,1),-12),q((1,0,0), 16)) for _ in K]
        tr['LeftForeArm']=[q((1,0,0),-38) for _ in K]
        tr['RightForeArm']=[q((1,0,0),-38) for _ in K]
    else:
        tr['Neck']=[qmul(q((0,1,0),3.2*math.sin(k*0.5)),
                         q((0,1,0),bump(k,0.5*PI,0.28*PI,glance))) for k in K]
        tr['LeftArm']=[qmul(q((0,0,1), 9+shZ*math.sin(2*k)),q((1,0,0),1.3*math.sin(k))) for k in K]
        tr['RightArm']=[qmul(q((0,0,1),-9-shZ*math.sin(2*k)),q((1,0,0),-1.3*math.sin(k))) for k in K]
        tr['LeftForeArm']=[q((1,0,0),-12) for _ in K]
        tr['RightForeArm']=[q((1,0,0),-12) for _ in K]
    tr['LeftShoulder']=[q((0,0,1), shZ*0.6*math.sin(2*k)) for k in K]
    tr['RightShoulder']=[q((0,0,1),-shZ*0.6*math.sin(2*k)) for k in K]
    tr['LeftUpLeg']=[q((1,0,0),mixv(-2, 3,sh(k))) for k in K]
    tr['RightUpLeg']=[q((1,0,0),mixv( 3,-2,sh(k))) for k in K]
    tr['LeftLeg']=[q((1,0,0),mixv(4,7,sh(k))) for k in K]     # soft knees
    tr['RightLeg']=[q((1,0,0),mixv(7,4,sh(k))) for k in K]
    tr['LeftFoot']=[q((1,0,0),mixv(-2,-4,sh(k))) for k in K]
    tr['RightFoot']=[q((1,0,0),mixv(-4,-2,sh(k))) for k in K]
    hipsT=[[round(mixv(-shiftX,shiftX,sh(k)),4),
            round(HIP_Y-0.006+0.004*math.sin(2*k),4),0.0] for k in K]
    hipsR=[q((0,0,1),mixv(1.4,-1.4,sh(k))) for k in K]
    return {'duration':times[-1],'times':times,'quat':tr,'hipsPos':hipsT,'hipsQuat':hipsR}

def crouch(n=32,dur=4.0):
    """Crouched WORK, not a crouched statue: the right hand works at the
    task in uneven pulls, and mid-loop Andrei checks the street over his
    shoulder while his hands keep moving. This clip is the picture of the
    game's core verb (servicing a drop)."""
    PI = math.pi
    times=[round(i*dur/n,4) for i in range(n+1)]
    K=[2*PI*i/n for i in range(n+1)]
    tr={}
    tr['LeftUpLeg']=[q((1,0,0),-86) for _ in K]
    tr['RightUpLeg']=[q((1,0,0),-80) for _ in K]
    tr['LeftLeg']=[q((1,0,0),108) for _ in K]
    tr['RightLeg']=[q((1,0,0),102) for _ in K]
    tr['LeftFoot']=[q((1,0,0),-26+2*math.sin(3*k)) for k in K]
    tr['RightFoot']=[q((1,0,0),-24-2*math.sin(3*k)) for k in K]
    tr['Spine']=[q((1,0,0),-22-1.5*math.sin(2*k)) for k in K]
    tr['Spine1']=[q((1,0,0),-13) for _ in K]
    # the over-the-shoulder check: neck leads, upper spine follows at 0.3
    tr['Spine2']=[qmul(q((1,0,0),-10),q((0,1,0),bump(k,1.3*PI,0.35*PI,7))) for k in K]
    tr['Neck']=[qmul(q((1,0,0),22),q((0,1,0),bump(k,1.3*PI,0.35*PI,24))) for k in K]
    # working hand: two uneven pulls per loop
    tr['RightArm']=[qmul(q((0,0,1),-14),q((1,0,0),-38-5*math.sin(2*k)-3*math.sin(3*k))) for k in K]
    tr['RightForeArm']=[q((1,0,0),-46-12*math.sin(2*k)-6*math.sin(3*k+0.7)) for k in K]
    tr['LeftArm']=[qmul(q((0,0,1),13),q((1,0,0),-10)) for _ in K]
    tr['LeftForeArm']=[q((1,0,0),-30-3*math.sin(2*k)) for k in K]
    hipsT=[[0.0,round(0.470+0.006*math.sin(2*k),4),round(0.008*math.sin(3*k),4)] for k in K]
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

JOG_SPEED = 4.05   # bible-authored speed for the default jog clip

def build_clips(spec):
    GD = ARCHETYPES.get('_gaitDefaults', {})
    walkP = {**GD.get('walk', {}), **spec['gait']['walk']}
    jogP  = {**GD.get('jog', {}),  **spec['gait'].get('jog', {})}
    idleP = {**GD.get('idle', {}), **spec['gait'].get('idle', {})}
    stoop = spec['mesh']['stoopDeg']
    clips = {
        'idle':   idle(idleP),
        'walk':   gait(walkP),
        'jog':    gait(jogP),
        'crouch': crouch(),
    }
    for c in clips.values(): apply_stoop(c, stoop)
    # walk speed is derived from stride geometry; the default jog keeps the
    # bible-authored 4.05, an overridden jog re-derives from its own stride
    jog_speed = JOG_SPEED if not spec['gait'].get('jog') else walk_speed(jogP['swing'], jogP['dur'])
    speeds = {'idle':0.0,'walk':walk_speed(walkP['swing'],walkP['dur']),'jog':jog_speed,'crouch':0.0}
    return clips, speeds

# ------------------------------------------------------------------ export
# Fixed part colours, all from the established palette / prototype coat set.
FIXED_COLOURS = {
    'Skin':         '#b4a88e',   # bone — reads cream under the warm lights
    'SkinDetail':   '#8d806c',
    'EyeWhite':     '#d8d3c5',
    'Iris':         '#2c2b25',
    'Lips':         '#8a655c',
    'Shoes':        '#35301f',   # trim — shoes and boots
    'Trim':         '#35301f',
    'CapCloth':     '#746a55',
    'MilitiaCloth': '#585c50',
    'State':        '#c0201f',   # red is the state's alone
    'Scarf':        '#77785f',   # sage — rust saturated toward red territory
    'Boards':       '#c09550',   # ochre — rank boards read at distance
    'Muffler':      '#8a7d66',
    'Outline':      '#231d15',   # swapped for BackSide ink by the runtime
}
# 'Legs' is per-archetype (trousers vs stockings), from mesh.legsColor.

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

    mat_names = ['Body','Hair','Legs'] + list(FIXED_COLOURS.keys())
    materials, MI = [], {}
    for mn in mat_names:
        if mn == 'Body': rgb = hex_to_rgb(spec['coats'][0])
        elif mn == 'Hair': rgb = hex_to_rgb(spec['mesh'].get('hairColor') or '#35301f')
        elif mn == 'Legs': rgb = hex_to_rgb(spec['mesh'].get('legsColor') or '#46423a')
        elif mn == 'Skin': rgb = hex_to_rgb(spec['mesh'].get('skinColor') or FIXED_COLOURS['Skin'])
        elif mn == 'SkinDetail': rgb = hex_to_rgb(spec['mesh'].get('skinDetailColor') or FIXED_COLOURS['SkinDetail'])
        elif mn == 'Iris': rgb = hex_to_rgb(spec['mesh'].get('eyeColor') or FIXED_COLOURS['Iris'])
        else: rgb = hex_to_rgb(FIXED_COLOURS[mn])
        MI[mn] = len(materials)
        materials.append(Material(name=mn, pbrMetallicRoughness=PbrMetallicRoughness(
            baseColorFactor=[rgb[0],rgb[1],rgb[2],1.0], metallicFactor=0.0, roughnessFactor=1.0)))

    def push_body_mesh(g):
        a_pos = push(g['position'], np.float32, FLOAT, 'VEC3', ARRAY_BUF, minmax=True)
        a_nrm = push(g['normal'],   np.float32, FLOAT, 'VEC3', ARRAY_BUF)
        a_jnt = push(g['skinIndex'], np.uint16, U16, 'VEC4', ARRAY_BUF)
        a_wgt = push(g['skinWeight'], np.float32, FLOAT, 'VEC4', ARRAY_BUF)
        prims = []
        for mat, idx in g['groups'].items():
            a_idx = push(idx, np.uint16, U16, 'SCALAR', ELEM_BUF)
            prims.append(Primitive(attributes=Attributes(POSITION=a_pos, NORMAL=a_nrm,
                                                         JOINTS_0=a_jnt, WEIGHTS_0=a_wgt),
                                   indices=a_idx, mode=4, material=MI[mat]))
        # Baked outline shell: same skin, positions pushed along normals.
        # Only silhouette-forming triangles are included (g['shell']) — face
        # features, buttons, lapels etc. would double the cost for nothing.
        shell_pos = g['position'] + g['normal']*OUTLINE_THICKNESS
        a_shell = push(shell_pos, np.float32, FLOAT, 'VEC3', ARRAY_BUF, minmax=True)
        a_all = push(g['shell'], np.uint16, U16, 'SCALAR', ELEM_BUF)
        prims.append(Primitive(attributes=Attributes(POSITION=a_shell, NORMAL=a_nrm,
                                                     JOINTS_0=a_jnt, WEIGHTS_0=a_wgt),
                               indices=a_all, mode=4, material=MI['Outline']))
        return Mesh(primitives=prims)

    def push_att_mesh(g, mat):
        a_pos = push(g['position'], np.float32, FLOAT, 'VEC3', ARRAY_BUF, minmax=True)
        a_nrm = push(g['normal'],   np.float32, FLOAT, 'VEC3', ARRAY_BUF)
        idx = np.concatenate([i for i in g['groups'].values()])
        a_idx = push(idx, np.uint16, U16, 'SCALAR', ELEM_BUF)
        return Mesh(primitives=[Primitive(attributes=Attributes(POSITION=a_pos, NORMAL=a_nrm),
                                          indices=a_idx, mode=4, material=MI[mat])])

    meshes = [push_body_mesh(body)]

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

    for (bone, mat, g) in attachments:
        meshes.append(push_att_mesh(g, mat))
        ni = len(nodes)
        nodes.append(Node(name=f'att_{mat}_{ni}', mesh=len(meshes)-1))
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
    """Sign assertions on every clip. Knees flex backward (positive X),
    forearms flex up (negative X), always — an inverted sine is just a
    phase shift on hips, but knees and elbows give it away instantly."""
    for cname, c in clips.items():
        for bone in ('LeftLeg','RightLeg'):
            for qq in c['quat'][bone]:
                assert qq[0] > 0, f'{name}/{cname}/{bone}: knee flexion sign inverted'
        for bone in ('LeftForeArm','RightForeArm'):
            for qq in c.get('quat', {}).get(bone, []):
                assert qq[0] < 0, f'{name}/{cname}/{bone}: elbow flexion sign inverted'

def main():
    os.makedirs(OUT_DIR, exist_ok=True)
    total = 0
    for name, spec in ARCHETYPES.items():
        if name.startswith('_'): continue
        body = build_body(spec['mesh'])
        atts = []
        for a in spec['mesh']['attachments']:
            atts.extend(ATTACHMENTS[a](spec['mesh']))
        clips, speeds = build_clips(spec)
        verify_knees(clips, name)
        path = os.path.join(OUT_DIR, f'{name}.glb')
        size = export_glb(path, name, spec, body, atts, clips, speeds)
        tris = sum(len(i)//3 for i in body['groups'].values())
        tris += sum(len(i)//3 for _,_,g in atts for i in g['groups'].values())
        total += size
        parts = ','.join(sorted(body['groups'].keys()))
        print(f'{name:14s} tris={tris:5d} walk={speeds["walk"]:.3f} m/s '
              f'buffer={size//1024}KB parts=[{parts}]')
    print(f'total buffers {total//1024}KB')

if __name__ == '__main__':
    sys.exit(main())

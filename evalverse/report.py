"""Build out/report.html from out/results.json  (single file, works offline)."""
from __future__ import annotations

import json
from collections import Counter, defaultdict
from pathlib import Path

from . import core

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / "out"
LABELS = [
    "grounded_correct",
    "correct_ungrounded",
    "misread",
    "mislocated",
    "abstained",
    "invalid_output",
]


def image_ref(case: dict, cond: str) -> str | None:
    """Relative path from out/report*.html to the pixels for this case/variant."""
    pert = OUT / "perturbed" / f"{case['id']}_{cond}.png"
    if pert.exists():
        return f"perturbed/{case['id']}_{cond}.png"
    # Fall back to the original dataset image for clean (or when perturbed is missing).
    src = case.get("image")
    if src:
        p = ROOT / src
        if p.exists():
            return f"../{src}"
    return None


def aggregate(res: dict) -> dict:
    runs, judged, cases = res["runs"], res["judged"], res["cases"]
    agents, conds = res["meta"]["agents"], res["meta"]["conditions"]
    by_id = {c["id"]: c for c in cases}
    margin = float(res.get("meta", {}).get("evidence_margin", 25))
    summary = {}
    for a in agents:
        summary[a] = {}
        for c in conds:
            rs = [r for r in runs if r["agent"] == a and r["condition"] == c]
            n = len(rs) or 1
            cnt = Counter(r["label"] for r in rs)
            strict_g = 0
            line_g = 0
            for r in rs:
                case = by_id.get(r["case_id"])
                if case is None or not r.get("correct"):
                    continue
                box = r.get("box")
                if core.evidence_ok(case["truth_box"], box, margin=0):
                    strict_g += 1
                if core.evidence_ok(case["truth_box"], box, margin=margin):
                    line_g += 1
            summary[a][c] = {
                "n": len(rs),
                "answer_acc": sum(r["correct"] for r in rs) / n,
                "grounded_acc": cnt["grounded_correct"] / n,
                "grounded_acc_strict": strict_g / n,
                "grounded_acc_line": line_g / n,
                "counts": {k: cnt.get(k, 0) for k in LABELS},
            }
    blind = {}
    for a in agents:
        clean = {r["case_id"]: r for r in runs if r["agent"] == a and r["condition"] == "clean"}
        bl = {r["case_id"]: r for r in runs if r["agent"] == a and r["condition"] == "blind"}
        ok = [cid for cid, r in clean.items() if r["correct"]]
        dependent = [cid for cid in ok if cid in bl and not bl[cid]["correct"]]
        blind[a] = {
            "blind_correct": sum(r["correct"] for r in bl.values()),
            "n": len(bl),
            "clean_correct": len(ok),
            "needed_image": len(dependent),
        }
    j = defaultdict(lambda: {"n": 0, "agree": 0, "accepted": 0, "errors": 0})
    for r in judged:
        k = r["kind"]
        if r["judge_accepts"] is None:
            j[k]["errors"] += 1
            continue
        j[k]["n"] += 1
        j[k]["agree"] += int(bool(r["agrees"]))
        j[k]["accepted"] += int(bool(r["judge_accepts"]))
    return {"summary": summary, "blind": blind, "judge": dict(j)}


def main():
    import argparse
    ap = argparse.ArgumentParser()
    ap.add_argument("--tag", default="", help="suite tag used in run.py")
    args = ap.parse_args()
    suffix = f"_{args.tag}" if args.tag else ""
    res = json.loads((OUT / f"results{suffix}.json").read_text())
    res["agg"] = aggregate(res)
    images = {}
    for c in res["cases"]:
        for cond in list(dict.fromkeys(res["meta"]["conditions"] + ["clean"])):
            key = f"{c['id']}|{cond}"
            if key not in images:
                images[key] = image_ref(c, cond)
    # Slim payload for the HTML viewer: keep paths not pixels, drop heavy run artifacts.
    slim_runs = []
    for r in res["runs"]:
        slim_runs.append(
            {
                k: r.get(k)
                for k in (
                    "agent",
                    "case_id",
                    "condition",
                    "answer",
                    "box",
                    "evidence",
                    "correct",
                    "evidence_ok",
                    "iou",
                    "label",
                    "latency",
                    "error",
                )
            }
        )
    payload = {
        "meta": res["meta"],
        "cases": res["cases"],
        "runs": slim_runs,
        "judged": res["judged"],
        "agg": res["agg"],
        "images": images,
        "dimension_summary": res.get("dimension_summary") or [],
    }
    blob = json.dumps(payload).replace("</", "<\\/")
    html = TEMPLATE.replace("__DATA__", blob)
    target = OUT / f"report{suffix}.html"
    target.write_text(html)
    print(f"wrote {target} ({len(html) / 1e6:.2f} MB)")


TEMPLATE = r"""<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>EvalVerse report</title>
<style>
:root{
  --paper:#EEF1F5; --card:#FFFFFF; --ink:#101B2D; --muted:#5B6B80; --rule:#CBD3DD;
  --truth:#0B8F7A; --agent:#D4285C; --amber:#C98512; --slate:#6A7B93; --grey:#A9B3C1;
  --abstain:#D5DAE2;
}
*{box-sizing:border-box}
body{margin:0;background:var(--paper);color:var(--ink);font:16px/1.5 system-ui,-apple-system,"Segoe UI",Roboto,sans-serif}
.wrap{max-width:1180px;margin:0 auto;padding:40px 28px 80px}
header{display:flex;justify-content:space-between;align-items:flex-end;gap:24px;flex-wrap:wrap;border-bottom:2px solid var(--ink);padding-bottom:22px}
h1{margin:0;font-size:58px;line-height:1;letter-spacing:-.035em;font-weight:800}
.tag{margin:10px 0 0;font-size:20px;color:var(--muted);max-width:34ch}
.meta{font:13px/1.6 ui-monospace,SFMono-Regular,Menlo,monospace;color:var(--muted);text-align:right}
h2{font-size:24px;letter-spacing:-.015em;margin:56px 0 4px}
.sub{margin:0 0 20px;color:var(--muted);max-width:70ch}
.grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(340px,1fr));gap:20px}
.card{background:var(--card);border:1px solid var(--rule);border-radius:10px;padding:20px}
.card h3{margin:0 0 14px;font:600 15px ui-monospace,SFMono-Regular,Menlo,monospace}
.row{display:grid;grid-template-columns:68px 1fr 64px;align-items:center;gap:10px;margin:9px 0;font-size:14px}
.bar{display:flex;height:22px;border-radius:4px;overflow:hidden;background:#E6EAF0}
.bar i{display:block;height:100%}
.row b{font-variant-numeric:tabular-nums;text-align:right}
.legend{display:flex;gap:18px;flex-wrap:wrap;margin-top:16px;font-size:13px;color:var(--muted)}
.legend span::before{content:"";display:inline-block;width:11px;height:11px;border-radius:2px;margin-right:6px;vertical-align:-1px;background:var(--c)}
.stat{font-size:40px;font-weight:800;letter-spacing:-.03em;line-height:1.1}
.stat small{display:block;font-size:14px;font-weight:400;letter-spacing:0;color:var(--muted);margin-top:4px}
.stats{display:grid;grid-template-columns:repeat(auto-fit,minmax(200px,1fr));gap:20px}
.explorer{display:grid;grid-template-columns:300px 1fr;gap:20px;align-items:start}
.controls{display:flex;gap:10px;flex-wrap:wrap;margin-bottom:14px}
select{font:inherit;padding:7px 10px;border:1px solid var(--rule);border-radius:6px;background:#fff;color:var(--ink)}
select:focus-visible,button:focus-visible{outline:3px solid var(--truth);outline-offset:2px}
.list{max-height:720px;overflow:auto;background:var(--card);border:1px solid var(--rule);border-radius:10px}
.list button{all:unset;box-sizing:border-box;display:flex;justify-content:space-between;align-items:center;gap:8px;width:100%;padding:10px 14px;border-bottom:1px solid #E6EAF0;cursor:pointer;font-size:14px}
.list button:hover{background:#F4F6F9}
.list button[aria-current=true]{background:var(--ink);color:#fff}
.chip{font-size:12px;padding:2px 8px;border-radius:99px;color:#fff;white-space:nowrap}
.viewer{background:var(--card);border:1px solid var(--rule);border-radius:10px;padding:20px}
.imgbox{position:relative;display:inline-block;max-width:100%;line-height:0;border:1px solid var(--rule)}
.imgbox img{max-width:100%;max-height:560px;display:block}
.imgbox svg{position:absolute;inset:0;width:100%;height:100%}
.imgph{display:flex;align-items:center;justify-content:center;min-width:280px;min-height:200px;max-width:100%;background:#E6EAF0;color:var(--muted);font-size:14px;padding:24px;text-align:center}
.facts{display:grid;grid-template-columns:140px 1fr;gap:6px 14px;margin:18px 0 0;font-size:14px}
.facts dt{color:var(--muted)} .facts dd{margin:0}
.key{display:flex;gap:18px;margin-top:12px;font-size:13px;color:var(--muted)}
.key span::before{content:"";display:inline-block;width:18px;height:0;border-top:3px solid var(--c);margin-right:6px;vertical-align:3px}
.key span.dash::before{border-top-style:dashed}
code{font:13px ui-monospace,SFMono-Regular,Menlo,monospace}
.note{font-size:13px;color:var(--muted);margin-top:10px}
table.dim{width:100%;border-collapse:collapse;font-size:14px;background:var(--card);border:1px solid var(--rule);border-radius:10px;overflow:hidden}
table.dim th,table.dim td{padding:10px 12px;border-bottom:1px solid #E6EAF0;text-align:left}
table.dim th{background:#F4F6F9;font-weight:600}
table.dim td.num{font-variant-numeric:tabular-nums;text-align:right}
@media (max-width:820px){.explorer{grid-template-columns:1fr}h1{font-size:44px}.meta{text-align:left}}
</style>
</head>
<body>
<div class="wrap">
<header>
  <div><h1>EvalVerse</h1><p class="tag">Did the agent actually look at the image?</p></div>
  <div class="meta" id="meta"></div>
</header>

<h2>Where each answer went right or wrong</h2>
<p class="sub">Every answer is placed in one bucket using the answer and the region the agent says it read from. A correct answer from the wrong place is not the same as a grounded one. Grounded share is shown strict and within one line (vertical margin).</p>
<div class="grid" id="scorecards"></div>
<div class="legend" id="legend"></div>

<h2>Scores by dimension</h2>
<p class="sub">Per-dimension means from the evaluator registry. Missing scores are never treated as zero. Confident errors are wrong answers that are not abstentions.</p>
<div id="dimensions"></div>

<h2>Did it need the image?</h2>
<p class="sub">Each question is asked again with no image attached. Values are random, so a right answer without the image is luck or leakage, not reading.</p>
<div class="grid" id="blind"></div>

<h2>Can the judge be trusted?</h2>
<p class="sub">A vision judge reads the image and rules on a proposed answer. We test it on answers where we already know the truth: the right answer, and a plausible wrong one taken from the same image.</p>
<div class="stats card" id="judge"></div>

<h2>Case explorer</h2>
<p class="sub">Teal is where the answer really is. Crimson is where the agent says it looked. The line between them is the miss.</p>
<div class="controls">
  <label>Agent <select id="selAgent"></select></label>
  <label>Image <select id="selCond"></select></label>
  <label>Outcome <select id="selLabel"></select></label>
</div>
<div class="explorer">
  <div class="list" id="list" role="list"></div>
  <div class="viewer" id="viewer"></div>
</div>
</div>

<script>
const D = __DATA__;
const LAB = {
  grounded_correct:{t:"Right answer, right place",c:"var(--truth)"},
  correct_ungrounded:{t:"Right answer, wrong place",c:"var(--amber)"},
  misread:{t:"Right place, misread",c:"var(--slate)"},
  mislocated:{t:"Looked in the wrong place",c:"var(--agent)"},
  abstained:{t:"Said it could not read it",c:"var(--abstain)"},
  invalid_output:{t:"Unusable output",c:"var(--grey)"}
};
const CONDNAME = {clean:"clean", blur:"blurred", noise:"noisy", lowres:"low-res", blind:"no image"};
const pct = x => Math.round(x*100)+"%";
const $ = id => document.getElementById(id);
const esc = s => String(s==null?"":s).replace(/[&<>"]/g,m=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;"}[m]));

const margin = (D.meta && D.meta.evidence_margin != null) ? D.meta.evidence_margin : 25;
$("meta").innerHTML = `agents: ${D.meta.agents.map(esc).join(", ")}<br>judge: ${esc(D.meta.judge)}<br>${D.cases.length} cases, ${D.meta.conditions.length} image conditions<br>evidence margin: ${esc(margin)}<br>${D.meta.mock?"MOCK DATA (offline test)":esc(D.meta.created)}`;

// scorecards
$("scorecards").innerHTML = D.meta.agents.map(a=>{
  const rows = D.meta.conditions.map(c=>{
    const s = D.agg.summary[a][c]; const n = s.n||1;
    const segs = Object.keys(LAB).map(k=>`<i title="${LAB[k].t}: ${s.counts[k]||0}" style="width:${(s.counts[k]||0)/n*100}%;background:${LAB[k].c}"></i>`).join("");
    const strict = s.grounded_acc_strict != null ? s.grounded_acc_strict : s.grounded_acc;
    const line = s.grounded_acc_line != null ? s.grounded_acc_line : s.grounded_acc;
    return `<div class="row"><span>${CONDNAME[c]}</span><div class="bar">${segs}</div><b title="strict ${pct(strict)} / within one line ${pct(line)}">${pct(strict)}<br><span style="font-weight:400;color:var(--muted);font-size:11px">${pct(line)} line</span></b></div>`;
  }).join("");
  return `<div class="card"><h3>${esc(a)}</h3>${rows}</div>`;
}).join("");
$("legend").innerHTML = Object.keys(LAB).map(k=>`<span style="--c:${LAB[k].c}">${LAB[k].t}</span>`).join("");

// dimension table
(function(){
  const rows = D.dimension_summary || [];
  if(!rows.length){ $("dimensions").innerHTML = `<p class="note">No dimension_summary in this results file. Run rescore.</p>`; return; }
  const body = rows.map(r=>{
    const ms = r.mean_score == null ? "—" : (Math.round(r.mean_score*1000)/1000);
    return `<tr><td>${esc(r.agent)}</td><td>${esc(r.variant)}</td><td>${esc(r.dimension)}</td><td>${esc(r.evaluator_id)}</td><td class="num">${r.n}</td><td class="num">${ms}</td><td class="num">${r.skipped||0}</td><td class="num">${r.errors||0}</td></tr>`;
  }).join("");
  $("dimensions").innerHTML = `<table class="dim"><thead><tr><th>Agent</th><th>Variant</th><th>Dimension</th><th>Evaluator</th><th>n</th><th>Mean</th><th>Skipped</th><th>Errors</th></tr></thead><tbody>${body}</tbody></table>`;
})();

// blind
$("blind").innerHTML = D.meta.agents.map(a=>{
  const b = D.agg.blind[a];
  const dep = b.clean_correct ? pct(b.needed_image/b.clean_correct) : "n/a";
  return `<div class="card"><h3>${esc(a)}</h3><div class="stats">
    <div class="stat">${dep}<small>of its correct answers needed the image (${b.needed_image} of ${b.clean_correct})</small></div>
    <div class="stat">${b.blind_correct}<small>of ${b.n} questions answered correctly with no image</small></div></div></div>`;
}).join("");

// judge
(function(){
  const J = D.agg.judge; const g = k => J[k] || {n:0,agree:0,accepted:0};
  const fa = g("planted_wrong"), fr = g("planted_right"), ag = g("agent_answer");
  $("judge").innerHTML = `
   <div class="stat">${fa.accepted} of ${fa.n}<small>planted wrong answers the judge accepted</small></div>
   <div class="stat">${fr.n-fr.accepted} of ${fr.n}<small>planted right answers the judge rejected</small></div>
   <div class="stat">${ag.n?pct(ag.agree/ag.n):"n/a"}<small>agreement with ground truth on the agents' own answers</small></div>`;
})();

// explorer
function fill(sel, items){ sel.innerHTML = items.map(([v,t])=>`<option value="${v}">${esc(t)}</option>`).join(""); }
fill($("selAgent"), D.meta.agents.map(a=>[a,a]));
fill($("selCond"), D.meta.conditions.map(c=>[c,CONDNAME[c]]));
fill($("selLabel"), [["all","all outcomes"], ...Object.keys(LAB).map(k=>[k,LAB[k].t])]);
const caseById = Object.fromEntries(D.cases.map(c=>[c.id,c]));
let current = null;

function runsFor(){
  const a=$("selAgent").value, c=$("selCond").value, l=$("selLabel").value;
  return D.runs.filter(r=>r.agent===a && r.condition===c && (l==="all"||r.label===l));
}
function renderList(){
  const rs = runsFor();
  if(!rs.find(r=>r.case_id===current)) current = rs.length?rs[0].case_id:null;
  $("list").innerHTML = rs.length ? rs.map(r=>{
      const lab = LAB[r.label] || LAB.invalid_output;
      return `<button role="listitem" data-id="${r.case_id}" aria-current="${r.case_id===current}">
      <span>${esc(r.case_id)}</span><span class="chip" style="background:${lab.c};color:${r.label==="abstained"?"#101B2D":"#fff"}">${lab.t}</span></button>`;
    }).join("")
    : `<div style="padding:14px;color:var(--muted)">No cases match. Change the outcome filter.</div>`;
  $("list").querySelectorAll("button").forEach(b=>b.onclick=()=>{current=b.dataset.id;renderList();renderViewer();});
  renderViewer();
}
function center(b){return [(b[0]+b[2])/2,(b[1]+b[3])/2];}
function mediaBlock(key, alt){
  const src = D.images[key];
  if(!src) return `<div class="imgph">Image missing<br><code>${esc(key)}</code></div>`;
  return `<div class="imgbox"><img alt="${esc(alt)}" src="${esc(src)}" onerror="this.parentNode.replaceWith(Object.assign(document.createElement('div'),{className:'imgph',innerHTML:'Image missing<br><code>${esc(src)}</code>'}))"><svg viewBox="0 0 1000 1000" preserveAspectRatio="none" aria-hidden="true">__SVG__</svg></div>`;
}
function renderViewer(){
  const v=$("viewer");
  if(!current){v.innerHTML="";return;}
  const a=$("selAgent").value, cond=$("selCond").value, cs=caseById[current];
  const r = D.runs.find(x=>x.agent===a&&x.case_id===current&&x.condition===cond);
  const bl = D.runs.find(x=>x.agent===a&&x.case_id===current&&x.condition==="blind");
  const jd = D.judged.find(x=>x.kind==="agent_answer"&&x.agent===a&&x.case_id===current);
  const t = cs.truth_box; let svg = `<rect x="${t[0]}" y="${t[1]}" width="${t[2]-t[0]}" height="${t[3]-t[1]}" fill="none" stroke="var(--truth)" stroke-width="3" vector-effect="non-scaling-stroke"/>`;
  if(r.box){
    const b=r.box, ct=center(t), cb=center(b);
    svg += `<line x1="${cb[0]}" y1="${cb[1]}" x2="${ct[0]}" y2="${ct[1]}" stroke="#101B2D" stroke-width="2" stroke-dasharray="2 5" vector-effect="non-scaling-stroke"/>`;
    svg += `<rect x="${b[0]}" y="${b[1]}" width="${b[2]-b[0]}" height="${b[3]-b[1]}" fill="none" stroke="var(--agent)" stroke-width="3" stroke-dasharray="9 6" vector-effect="non-scaling-stroke"/>`;
  }
  const judgeTxt = jd ? (jd.judge_accepts===null?"judge error":(jd.judge_accepts?"accepted":"rejected")+(jd.agrees?" (matches truth)":" (disagrees with truth)")) : "n/a";
  const lab = LAB[r.label] || LAB.invalid_output;
  const media = mediaBlock(current+"|"+cond, (cs.family||cs.id)+" "+(CONDNAME[cond]||cond)).replace("__SVG__", svg);
  v.innerHTML = `${media}
   <div class="key"><span style="--c:var(--truth)">where the answer is</span><span class="dash" style="--c:var(--agent)">where the agent looked</span></div>
   <dl class="facts">
    <dt>Question</dt><dd>${esc(cs.question)}</dd>
    <dt>Correct answer</dt><dd><code>${esc(cs.answer)}</code></dd>
    <dt>Agent answered</dt><dd><code>${esc(r.answer||"(nothing usable)")}</code></dd>
    <dt>Outcome</dt><dd>${lab.t}${r.box?`, box overlap ${r.iou}`:""}</dd>
    <dt>Agent said</dt><dd>${esc(r.evidence||"")}</dd>
    <dt>With no image</dt><dd>${bl?`<code>${esc(bl.answer||"(nothing usable)")}</code> ${bl.correct?"(right without the image)":"(wrong without the image)"}`:"n/a"}</dd>
    <dt>Judge on clean image</dt><dd>${judgeTxt}</dd>
    ${r.error?`<dt>Error</dt><dd><code>${esc(r.error)}</code></dd>`:""}
   </dl>`;
}
["selAgent","selCond","selLabel"].forEach(id=>$(id).onchange=renderList);
renderList();
</script>
</body>
</html>
"""

if __name__ == "__main__":
    main()

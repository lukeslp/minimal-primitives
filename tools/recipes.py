"""Private-scope adapter recipes. Only these invisible hooks change game code."""
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
SCRIPTS = {'akari': 'akari.js', 'galaxies': 'galaxies.js', 'bridges': 'bridges.js', 'slant': 'slant.js', 'fold': 'fold.js', 'horologist': 'plate.js', 'tilt': 'tilt-levels.js', 'notan': 'notan.js', 'bending': 'dark.mjs'}
FIELDS = {'akari': ['w','h','cells'], 'galaxies': ['w','h','centres'], 'bridges': ['w','h','islands'], 'slant': ['w','h','clues'], 'fold': ['w','h','pairs'], 'horologist': ['W','H','drive','clocks','pillars','tray'], 'tilt': ['levels'], 'bending': ['size','answer','lights','planets','beams','receivers']}


def hook(text, anchor, replacement, path):
    if text.count(anchor) != 1:
        raise ValueError(f'Adapter anchor drift in {path}: {anchor[:90]!r}, count={text.count(anchor)}')
    return text.replace(anchor, replacement, 1)


def inject(game, path, text):
    ident = game['id']
    alternate = path.startswith('akari-light/')
    if ident not in SCRIPTS or path.replace('akari-light/', 'akari/') != ident + '/' + SCRIPTS[ident]:
        return text
    if ident=='bridges':
        text=hook(text,"const query=new URLSearchParams(location.search),circuitMode=","const query=new URLSearchParams(location.search);let circuitMode=",path)
        text=hook(text,"route:circuitMode?(a,b)=>root._circuits.open(edgeIndex(p(),a,b)):null","get route(){return circuitMode?(a,b)=>root._circuits.open(edgeIndex(p(),a,b)):null;}",path)
        help_anchor=next(line for line in text.splitlines() if line.startswith("if(circuitMode){$('#help .controls').innerHTML="))
        text=hook(text,help_anchor,"const __minimalClassicHelp=$('#help .controls').innerHTML;function __minimalCircuitHelp(){"+help_anchor+"else{$('#help .controls').innerHTML=__minimalClassicHelp;}}__minimalCircuitHelp();",path)
    engine = 'well.mjs' if ident == 'bending' else 'engine.js'
    rules = next(f['sha256'][:16] for f in game['files'] if f['path'] == ident + '/' + engine)
    policy = {'horologist':'hits-v1','tilt':'moves-v1','fold':'folds-v1'}.get(ident, 'time-v1')
    layout = 'Object.fromEntries(' + json.dumps(FIELDS.get(ident, [])).replace(' ', '') + '.filter(k=>p[k]!==undefined).map(k=>[k,p[k]]))'
    if ident in {'akari','galaxies','bridges','slant','fold'}:
        mode = "(prefs.mode==='Hard'?'hard':'standard')" if ident == 'slant' else "(circuitMode?'circuits':'classic')" if ident == 'bridges' else "'campaign'"
        desc = f"const p=puzzle;return {{id:at,mode:{mode},layout:{layout},solved:S.solved,repeat:progress.completed.includes(at),restored:!!S.undo.length||" + ("!!S.path.length" if ident=='fold' else "S.cells.some(v=>v!==0)" if ident!='galaxies' else "!!store.boards[at]") + ",value:" + ('S.state.folds' if ident=='fold' else '0') + ",progress:{completed:progress.completed.length+(S.solved&&ids.has(at)&&!progress.completed.includes(at)?1:0)}}"
        snapshot = '({at,generated,store,progress,prefs,state:S,mode:' + ('null' if ident=='fold' else 'mode') + ",text:$('#feedback').textContent,dialogs:[...document.querySelectorAll('dialog[open]')].map(d=>d.id)" + (',practice:P,lesson' if ident in {'galaxies','bridges','slant'} or alternate else '') + (',practiceMode' if ident=='slant' or alternate else '') + (',free,freePuzzle,lockTool' if ident=='slant' else '') + '})'
        if ident=='akari' and not alternate: snapshot=snapshot[:-2]+',...(__minimalAkariPractice||{})})'
        if ident=='bridges': snapshot=snapshot[:-2]+",circuitMode,circuitOpen:$('#board .circuit-picker:not([hidden])')?.dataset.edge??null})"
        restore = "mainPainter.cancel();" if ident!='fold' else 'gesture=null;cancelAnimation();'
        if ident=='akari' and not alternate: restore += "__minimalAkariPractice=Object.fromEntries(['practice','lesson','practiceMode'].filter(k=>k in d).map(k=>[k,d[k]]));"
        restore += "store=d.store;progress=d.progress;Object.assign(prefs,d.prefs);write(K.settings,prefs);generated=d.generated;"
        if ident=='bridges': restore += "circuitMode=!!d.circuitMode;document.documentElement.classList.toggle('circuit-study',circuitMode);__minimalCircuitHelp();"
        if ident=='slant': restore += "Object.assign(free,d.free);freePuzzle=d.freePuzzle;lockTool=d.lockTool;$('#free-size').value=String(free.size);"
        restore += "switchBoard(d.at,true);Object.assign(S,d.state);"
        if ident!='fold': restore += "mode=d.mode;"
        if ident=='fold': restore += 'S.state=replay(puzzle,S.path);S.busy=false;'
        if ident in {'galaxies','bridges','slant'} or alternate: restore += 'lesson=d.lesson??0;resetPractice();Object.assign(P,d.practice);practiceDraw();'
        if ident=='slant' or alternate: restore += 'practiceMode=d.practiceMode;practiceFeedback();'
        restore += "applyPrefs();render();say(d.text||'');for(const id of d.dialogs||[])document.getElementById(id)?.showModal();save();"
        if ident=='bridges': restore += "if(d.circuitOpen!==null&&d.circuitOpen!==undefined)$('#board')._circuits?.open(+d.circuitOpen);"
        # Fold doesn't use a painter, and must finish committed folds before unload.
        settle = "async()=>{for(let n=0;S.busy&&n<80;n++)await new Promise(r=>setTimeout(r,25));if(S.busy)throw Error('Wait for the fold to finish.');}" if ident=='fold' else '()=>{mainPainter.cancel();}'
        proof = '({path:S.path,generated:at===\'generated\'?{seed:generated.seed,difficulty:generated.difficulty,version:generated.version}:null})' if ident=='fold' else "({cells:Array.from(S.cells),generated:at==='generated'?{seed:generated.seed,difficulty:generated.difficulty,version:generated.version}:null})"
        if ident=='bridges':
            anchor='s.solved=v.solved;'
            text=hook(text,anchor,anchor+'if(main)window.MinimalAdapter?.committed();',path)
        else:
            anchor='S.solved=E.inspect(puzzle,'+('S.state' if ident=='fold' else 'S.cells')+').solved;'
            if ident=='fold': anchor='function completion(announce=true){const was=S.solved;'+anchor
            text=hook(text,anchor,anchor+'window.MinimalAdapter?.committed();',path)
        for name,event in [('hint','assist'),('restart','restart')]:
            anchor='function '+name+'(){'
            if alternate and name=='restart': anchor="$('#reset').addEventListener('click',()=>{"
            text=hook(text,anchor,anchor+f'window.MinimalAdapter?.{event}();',path)
        if ident=='bridges':text=hook(text,'function undo(s,p,painter,main){','function undo(s,p,painter,main){if(main)window.MinimalAdapter?.undo();',path)
        elif ident=='fold':text=hook(text,'function undo(shown=true){','function undo(shown=true){window.MinimalAdapter?.undo();',path)
        else:text=hook(text,'function undo(){','function undo(){window.MinimalAdapter?.undo();',path)
        addon=f"\n{"let __minimalAkariPractice;" if ident=="akari" and not alternate else ""}\nconst __minimal=MinimalBridge.install({{rulesVersion:'{rules}',scoringPolicy:'{policy}',describe(){{{desc}}},snapshot:()=>{snapshot},restore(d){{{restore}}},settle:{settle},undoDepth:()=>S.undo.length,proof:()=>{proof}}});\nconst __minimalSave=save;save=function(){{const v=__minimalSave.apply(this,arguments);__minimal.changed();return v;}};\n"
    else:
        addon=(ROOT/'adapters/private'/f'{ident}.js').read_text().replace('__RULES__',rules).replace('__POLICY__',policy)
        if ident=='notan':
            text=hook(text,'  let tick = null;','  let tick = null, __minimalTickAt=0;',path)
            text=hook(text,'    tick = setInterval(() => {','    __minimalTickAt=performance.now();\n    tick = setInterval(() => {\n      __minimalTickAt=performance.now();',path)
            text=hook(text,'    S.solved = true;','    S.solved = true;\n    window.MinimalAdapter?.committed();',path)
            text=hook(text,'  function showHint() {','  function showHint() { window.MinimalAdapter?.assist();',path)
            text=hook(text,'  function startOver() {','  function startOver() { window.MinimalAdapter?.restart();',path)
            text=hook(text,'  function undo() {','  function undo() { window.MinimalAdapter?.undo();',path)
        elif ident=='horologist':
            text=hook(text,'const duration=reduced()?0:', 'window.MinimalAdapter?.committed();const duration=reduced()?0:',path)
            text=hook(text,'function showHint(){','function showHint(){window.MinimalAdapter?.assist();',path)
            text=hook(text,"if(a.type==='restart')tally", "if(a.type==='restart')window.MinimalAdapter?.restart();if(a.type==='restart')tally",path)
            text=hook(text,"if(a.type==='undo'){const p=m.history.pop();", "if(a.type==='undo'){if(m===M)window.MinimalAdapter?.undo();const p=m.history.pop();",path)
        elif ident=='tilt':
            text=hook(text,'    writeSave();\n    announce(dir, result);','    window.MinimalAdapter?.committed();\n    writeSave();\n    announce(dir, result);',path)
            text=hook(text,'  function armHint() {','  function armHint() { window.MinimalAdapter?.assist();',path)
            text=hook(text,'  function restart() {','  function restart() { window.MinimalAdapter?.restart();',path)
            text=hook(text,'  function undo() {','  function undo() { window.MinimalAdapter?.undo();',path)
        elif ident=='bending':
            text=hook(text,'    stage().solved = result.solved;', '    stage().solved = result.solved;\n    window.MinimalAdapter?.committed();',path)
            text=hook(text,'function hint() {','function hint() { window.MinimalAdapter?.assist();',path)
            text=hook(text,'function restart() {','function restart() { window.MinimalAdapter?.restart();',path)
            text=hook(text,'function undo() {','function undo() { window.MinimalAdapter?.undo();',path)
    if ident=='bending': return text+'\n'+addon
    end=text.rfind('})();')
    if end<0: raise ValueError('Missing closure: '+path)
    return text[:end]+addon+text[end:]

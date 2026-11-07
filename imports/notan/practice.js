/* Help is a sandbox: the same pointer adapter as play, independent cells/history. */
(function () {
  'use strict';
  const $=s=>document.querySelector(s), root=$('#practice'), row=$('#practice-row');
  const lessons=[
    {title:'One run',clue:'5',task:'Drag across all five.',answer:[1,1,1,1,1],done:'That’s one run of five.'},
    {title:'Leave a gap',clue:'3 1',task:'Three, a gap, then one. Hold the gap to mark it empty.',answer:[1,1,1,2,1],done:'Three, a gap, one.'},
    {title:'Only what is certain',clue:'4',task:'A 4 fits two ways. Fill only the squares both share.',answer:[0,1,1,1,0],done:'Only the middle three are certain.'}
  ];
  const s={cells:new Int8Array(5),undo:[],mark:false,lastTap:null,drag:null,pending:null};
  let lesson=0,focus=0,lastTo=null,shown=false;
  const cells=[];
  function render(i) {
    const n=cells[i],v=s.cells[i];
    n.classList.toggle('ink',v===1);n.classList.toggle('mark',v===2);
    n.setAttribute('aria-label','Column '+(i+1)+': '+['unknown','filled','marked empty'][v]);
    n.tabIndex=i===focus?0:-1;
  }
  function draw(){cells.forEach((_,i)=>render(i));$('#practice-mode').setAttribute('aria-pressed',String(s.mark));$('#practice-undo').disabled=!s.undo.length;}
  function focusAt(i,move=false){focus=i;draw();if(move)cells[i].focus({preventScroll:true});}
  function feedback(){
    const L=lessons[lesson],same=L.answer.every((v,i)=>s.cells[i]===v);
    $('#practice-feedback').textContent=same?(shown?'Example: ':'')+L.done:
      lesson===2&&(s.cells[0]||s.cells[4])?'The ends aren’t certain yet.':
      lesson===1&&s.cells[3]===1?'Runs need a gap between them.':
      s.cells.some(Boolean)?'':'';
  }
  for(let i=0;i<5;i++){
    const n=document.createElement('div');n.className='practice-cell';n.setAttribute('role','gridcell');
    n.addEventListener('focus',()=>focusAt(i));cells.push(n);row.append(n);
  }
  const painter=NotanPaint.bind({
    root,state:s,size:()=>({w:5,h:1}),rect:()=>row.getBoundingClientRect(),
    accept:e=>!!e.target.closest('.practice-cell'),render,focus:i=>focusAt(i,true),
    start:()=>{shown=false;},commit:()=>{draw();feedback();},restore:()=>{draw();feedback();}
  });
  root.addEventListener('contextmenu',e=>e.preventDefault());
  function undo(){painter.cancel();s.lastTap=null;const a=s.undo.pop();if(a)s.cells=a;shown=false;draw();feedback();}
  function reset(){painter.cancel();s.cells=new Int8Array(5);s.undo=[];s.lastTap=null;shown=false;lastTo=null;draw();feedback();}
  function showLesson(){
    reset();s.mark=false;draw();const L=lessons[lesson];
    $('#lesson-title').textContent=L.title;$('#lesson-count').textContent=(lesson+1)+' / '+lessons.length;
    $('#lesson-task').textContent=L.task;$('#practice-clue').textContent=L.clue;
    root.setAttribute('aria-label','Practice row, clue '+L.clue);
    $('#lesson-possibilities').classList.toggle('is-off',lesson!==2); // space kept, so every lesson is the same height
    $('#lesson-prev').disabled=lesson===0;
    $('#lesson-next').textContent=lesson===2?'Play':'Next';
    feedback();
  }
  for(const bits of [[1,1,1,1,0],[0,1,1,1,1]]){
    const n=document.createElement('div');n.className='possibility';n.setAttribute('role','img');
    n.setAttribute('aria-label','Four filled squares starting at column '+(bits[0]?1:2));
    for(const v of bits){const i=document.createElement('i');if(v)i.className='on';n.append(i);}
    $('#lesson-possibilities').append(n);
  }
  $('#practice-mode').addEventListener('click',()=>{painter.cancel();s.lastTap=null;s.mark=!s.mark;draw();});
  $('#practice-undo').addEventListener('click',undo);
  $('#practice-reset').addEventListener('click',reset);
  $('#practice-show').addEventListener('click',()=>{
    painter.cancel();s.lastTap=null;s.undo.push(Int8Array.from(s.cells));
    s.cells=Int8Array.from(lessons[lesson].answer);shown=true;draw();feedback();
  });
  $('#lesson-prev').addEventListener('click',()=>{if(lesson){lesson--;showLesson();}});
  $('#lesson-next').addEventListener('click',()=>{
    if(lesson===2){$('#help').close();return;}
    lesson++;showLesson();
  });
  root.addEventListener('keydown',e=>{
    let i=focus,to=null,moved=false;
    switch(e.key){
      case 'ArrowLeft':i=Math.max(0,i-1);moved=true;break;
      case 'ArrowRight':i=Math.min(4,i+1);moved=true;break;
      case 'ArrowUp':case 'ArrowDown':moved=true;break;
      case 'Home':i=0;moved=true;break;
      case 'End':i=4;moved=true;break;
      case ' ':case 'Enter':to=NotanPaint.toggle(s.cells[i],false);break;
      case 'x':case 'X':to=NotanPaint.toggle(s.cells[i],true);break;
      case 'Delete':case 'Backspace':to=0;break;
      case 'z':case 'Z':e.preventDefault();undo();return;
      default:return;
    }
    e.preventDefault();e.stopPropagation();s.lastTap=null;shown=false;
    if(moved){if(e.shiftKey&&lastTo!==null&&i!==focus)to=lastTo;focusAt(i,true);}
    if(to!==null&&s.cells[i]!==to){s.undo.push(Int8Array.from(s.cells));s.cells[i]=to;lastTo=to;draw();feedback();}
  });
  $('#help').addEventListener('close',()=>painter.cancel());
  showLesson();
})();

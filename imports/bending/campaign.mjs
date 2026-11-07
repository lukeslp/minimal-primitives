// Campaign records and the original 24-stage save migration. Luke Steuber.
import {placed, spots} from './well.mjs?v=0f8ac9d7';
const originalCount=24;
const blank=board=>({planets:board.answer.map(()=>null),hints:0,solved:false});
export const fresh=boards=>({v:2,board:0,stages:boards.map(blank),available:1,motion:true,sound:false});
function stageValid(stage,board){return stage&&Array.isArray(stage.planets)&&stage.planets.length===board.answer.length&&
 stage.planets.every(index=>index===null||Number.isInteger(index)&&index>=0&&index<spots(board).length)&&
 new Set(stage.planets.filter(index=>index!==null)).size===stage.planets.filter(index=>index!==null).length&&
 Number.isInteger(stage.hints)&&stage.hints>=0&&stage.hints<=board.answer.length&&
 typeof stage.solved==='boolean'&&stage.solved===placed(board,stage.planets).solved;}
function shape(save,boards,count){return save&&Number.isInteger(save.board)&&save.board>=0&&save.board<count&&
 typeof save.motion==='boolean'&&typeof save.sound==='boolean'&&Array.isArray(save.stages)&&save.stages.length===count&&
 save.stages.every((stage,index)=>stageValid(stage,boards[index]));}
export function valid(save,boards){return save?.v===2&&shape(save,boards,boards.length)&&
 Number.isInteger(save.available)&&save.available>=1&&save.available<=boards.length&&save.board<save.available&&
 save.stages.every((stage,index)=>!stage.solved||index<save.available);}
export function migrate(save,boards){
 if(valid(save,boards))return structuredClone(save);
 // Validate the entire old record against its unchanged prefix before appending blanks.
 if(save?.v!==1||boards.length<originalCount||!shape(save,boards,originalCount))return null;
 const record={...structuredClone(save),v:2,available:originalCount,stages:[...structuredClone(save.stages),...boards.slice(originalCount).map(blank)]};
 record.stages.forEach((stage,index)=>{if(stage.solved)unlock(record,index,boards);});
 return valid(record,boards)?record:null;
}
export function unlock(record,index,boards){record.available=Math.max(record.available,Math.min(boards.length,index+2));}

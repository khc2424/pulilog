// A transparent rubric, not a diagnosis or a claim about unseen classroom activity.
export const teachingStyleAxes=[
 {id:'starting_point',name:'설명 출발점',left:'개념 출발형',right:'문제 출발형',left_description:'개념과 조건을 전체적으로 정리한 뒤 문제에 적용',right_description:'기초 개념 뒤 문제를 풀면서 유형별 개념을 설명',evidence:'개념 설명과 첫 문제 풀이의 순서·분량',limitation:'교재 구성이나 수업 목표에 따라 같은 선생님도 달라질 수 있어요.'},
 {id:'participation',name:'수업 참여 방식',left:'시범 중심형',right:'질문 중심형',left_description:'선생님의 풀이 시범을 보여주는 시간이 중심',right_description:'질문·학생 풀이·필기와 응답을 기다리는 활동이 중심',evidence:'질문 발언, 풀이 지시, 응답 대기 구간',limitation:'자막만으로는 학생이 실제로 풀거나 필기한 시간을 확정할 수 없어요.'},
 {id:'explanation',name:'풀이 설명 방식',left:'단계 전개형',right:'핵심 압축형',left_description:'중간 과정과 풀이의 이유를 단계별로 강조',right_description:'전체 흐름과 유형별 핵심 경로를 압축해서 강조',evidence:'중간 과정의 연결 설명과 핵심 단계 요약',limitation:'판서에만 있는 중간 과정은 자막으로 확인할 수 없어요.'},
 {id:'practice',name:'유형 학습 방식',left:'반복 확인형',right:'확장 연결형',left_description:'유형의 공통점을 강조하고 반복 숙달',right_description:'유형의 차이와 조건 변경·응용을 강조',evidence:'공통 풀이 반복, 조건 변경, 다른 풀이·유형과의 연결',limitation:'한 차시의 시험 대비·선행 목적이 결과에 영향을 줄 수 있어요.'}
];

export function summarizeTeachingStyles(observations){
 return teachingStyleAxes.map(axis=>{
  const lessons=new Map();
  for(const row of observations||[]){
   if(row.axis!==axis.id||!row.video_id||!['left','right'].includes(row.direction)||!['high','medium','low'].includes(row.confidence)||!row.evidence?.length)continue;
   const key=row.video_id,record=lessons.get(key)||{left:0,right:0};record[row.direction]+=row.confidence==='high'?3:row.confidence==='medium'?2:1;lessons.set(key,record);
  }
  if(!lessons.size)return {...axis,lesson_count:0,left_percent:null,right_percent:null,result:'분석 전'};
  const left=[...lessons.values()].reduce((sum,r)=>sum+r.left/(r.left+r.right),0)/lessons.size;
  const percent=Math.round(left*100);
  return {...axis,lesson_count:lessons.size,left_percent:percent,right_percent:100-percent,result:percent>60?axis.left:percent<40?axis.right:'혼합형',provisional:lessons.size<3};
 });
}

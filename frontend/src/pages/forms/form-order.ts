import type { FormBlock, FormQuestion } from './forms.api';

export type MovingItem = { type: 'section'; id: number } | { type: 'question'; id: string };
export type DropPosition = { type: 'top'; index: number } | { type: 'section'; id: number; index: number };

export function moveFormItem(blocks: FormBlock[], moving: MovingItem, destination: DropPosition): FormBlock[] {
  if (destination.type === 'section' && (moving.type === 'section' || !blocks.some((block) => block.type === 'section' && block.section_id === destination.id))) return blocks;
  if (!Number.isInteger(destination.index) || destination.index < 0) return blocks;

  let sourceTop = -1;
  let sourceNested = -1;
  let movedBlock: FormBlock | undefined;
  let movedQuestion: FormQuestion | undefined;
  for (let i = 0; i < blocks.length; i++) {
    const block = blocks[i];
    if (moving.type === 'section' && block.type === 'section' && block.section_id === moving.id) { sourceTop = i; movedBlock = block; break; }
    if (moving.type === 'question' && block.type === 'question' && block.question.id === moving.id) { sourceTop = i; movedQuestion = block.question; break; }
    if (moving.type === 'question' && block.type === 'section') {
      const index = block.questions.findIndex((question) => question.id === moving.id);
      if (index !== -1) { sourceTop = i; sourceNested = index; movedQuestion = block.questions[index]; break; }
    }
  }
  if (sourceTop === -1) return blocks;
  const source = blocks[sourceTop];
  if (destination.type === 'top' && destination.index > blocks.length) return blocks;
  if (destination.type === 'section') {
    const target = blocks.find((block) => block.type === 'section' && block.section_id === destination.id);
    if (!target || target.type !== 'section' || destination.index > target.questions.length) return blocks;
  }

  const remaining = blocks.map((block, index) => index === sourceTop && sourceNested !== -1 && block.type === 'section'
    ? { ...block, questions: block.questions.filter((_, questionIndex) => questionIndex !== sourceNested) }
    : block).filter((_, index) => index !== sourceTop || sourceNested !== -1);

  if (destination.type === 'top') {
    const index = Math.max(0, destination.index - (sourceNested === -1 && sourceTop < destination.index ? 1 : 0));
    const item = movedBlock ?? (movedQuestion ? { type: 'question' as const, question: movedQuestion } : undefined);
    if (!item || (sourceNested === -1 && sourceTop === index)) return blocks;
    remaining.splice(index, 0, item);
    return remaining;
  }
  if (!movedQuestion) return blocks;
  const index = destination.index - (source.type === 'section' && source.section_id === destination.id && sourceNested < destination.index ? 1 : 0);
  if (source.type === 'section' && source.section_id === destination.id && sourceNested === index) return blocks;
  return remaining.map((block) => block.type === 'section' && block.section_id === destination.id
    ? { ...block, questions: [...block.questions.slice(0, index), movedQuestion, ...block.questions.slice(index)] }
    : block);
}

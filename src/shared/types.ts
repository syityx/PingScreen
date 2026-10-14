export const INTENTS = ['explain', 'translate', 'rewrite', 'custom'] as const;
export type Intent = typeof INTENTS[number];
export type TranslationMode = 'point' | 'line';
export type WheelAction = Intent | 'region';
export const ACTIONS: WheelAction[] = [...INTENTS, 'region'];
export const LABELS: Record<WheelAction, string> = { explain: '解释', translate: '翻译', rewrite: '改写', custom: '提问', region: '框选' };
export const SYMBOLS: Record<WheelAction, string> = { explain: '?', translate: '译', rewrite: '✎', custom: '…', region: '▣' };
export interface Point { x: number; y: number }
export interface Rect extends Point { width: number; height: number }
export type Target = { kind: 'point'; point: Point } | { kind: 'region'; rect: Rect };
export type Trigger = 'alt' | 'shift' | 'ctrl' | 'mouse4' | 'mouse5';
export const ANSWER_FONT_SIZE = { default: 16, min: 14, max: 24, step: 1 } as const;
export interface Settings { baseUrl: string; model: string; trigger: Trigger; wheelSlots: 4 | 5; dragThresholdPx: number; launchAtStartup: boolean; stream: boolean; answerFontSize: number }
export interface PublicSettings extends Settings { hasKey: boolean; secureStorage: boolean; keyProblem?: string }
export interface Turn { question: string; answer: string; status: 'generating' | 'done' | 'stopped' | 'error'; error?: string }
export interface StageState { id: string; image: string; width: number; height: number; origin: Point; wheelCenter: Point; cursor: Point; mode: 'wheel' | 'region' | 'regionIntent'; target: Target; wheelSlots: 4 | 5; translationMode?: TranslationMode }
export interface CardState { id: string; image: string; target: Target; intent: Intent; capturedAt: string; turns: Turn[]; awaitingQuestion: boolean; translationMode?: TranslationMode; answerFontSize: number }
export interface Status { helper: string; enabled: boolean }
export type UiEvent = { type: 'stage'; state: StageState | null } | { type: 'cursor'; id: string; point: Point } | { type: 'translationMode'; id: string; mode: TranslationMode } | { type: 'card'; state: CardState | null } | { type: 'status'; state: Status };
export const isIntent = (v: unknown): v is Intent => INTENTS.includes(v as Intent);
export const finite = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
export function validRect(v: unknown): v is Rect {
  if (!v || typeof v !== 'object') return false;
  const r = v as Rect;
  return [r.x, r.y, r.width, r.height].every(finite) && r.width >= 3 && r.height >= 3;
}

import type { Note } from '../notes/model';
export function NotesList({ notes, canDelete, onDelete }: { notes: Note[]; canDelete: boolean; onDelete: (id: string) => void }) {
  if (!notes.length) return <p className="empty-state">还没有笔记，写下第一条吧。</p>;
  return <ol className="notes-list">{notes.map(note => <li key={note.id} data-testid={`note-${note.sequence}`} value={note.sequence}>
    <span className="note-sequence" aria-label={`添加顺序 ${note.sequence}`}>#{note.sequence}</span>
    <p className="note-content">{note.content}</p>
    <button type="button" className="delete-button" aria-label={`删除笔记 ${note.sequence}`} disabled={!canDelete} onClick={() => onDelete(note.id)}>删除</button>
  </li>)}</ol>;
}

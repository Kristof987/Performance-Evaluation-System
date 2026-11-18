import { useEffect, useRef, useState } from 'react';
import { ChevronDown, Plus, X } from 'lucide-react';

export const MAX_COMPARED_GROUPS = 5;
const MAX_GROUP_CHIPS = 8;
const VISIBLE_SECTION_TABS = 6;

type Option = { id: number; name: string };

export function SectionTabs({ sections, selected, onSelect }: { sections: Option[]; selected: number | null; onSelect: (id: number | null) => void }) {
  const visible = sections.slice(0, VISIBLE_SECTION_TABS);
  const overflow = sections.slice(VISIBLE_SECTION_TABS);
  const selectedOverflow = overflow.find((section) => section.id === selected);
  const tab = (id: number | null, name: string) => <button key={id ?? 'all'} type="button" role="tab" aria-selected={selected === id} className={selected === id ? 'is-active' : ''} onClick={() => onSelect(id)}>{name}</button>;
  return <div className="reports-section-tabs" role="tablist" aria-label="Section">
    {tab(null, 'All sections')}
    {visible.map((section) => tab(section.id, section.name))}
    {overflow.length > 0 && <label className={`reports-section-more${selectedOverflow ? ' is-active' : ''}`}>
      <span>{selectedOverflow?.name ?? 'More'}</span><ChevronDown size={14} aria-hidden="true" />
      <select aria-label="More sections" value={selectedOverflow?.id ?? ''} onChange={(event) => onSelect(Number(event.target.value))}>
        <option value="" disabled>More sections</option>
        {overflow.map((section) => <option key={section.id} value={section.id}>{section.name}</option>)}
      </select>
    </label>}
  </div>;
}

function GroupPicker({ groups, onPick }: { groups: Option[]; onPick: (id: number) => void }) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const root = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return undefined;
    const close = (event: MouseEvent) => { if (!root.current?.contains(event.target as Node)) setOpen(false); };
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, [open]);
  const matches = groups.filter((group) => group.name.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase()));
  return <div className="reports-group-picker" ref={root}>
    <button type="button" className="reports-group-add" aria-expanded={open} onClick={() => setOpen((value) => !value)}><Plus size={14} aria-hidden="true" />Group</button>
    {open && <div className="reports-group-menu" role="dialog" aria-label="Add group" onKeyDown={(event) => { if (event.key === 'Escape') setOpen(false); }}>
      <input autoFocus type="search" placeholder="Search groups" aria-label="Search groups" value={query} onChange={(event) => setQuery(event.target.value)} />
      <ul>{matches.length === 0 ? <li className="reports-group-menu-empty">No matching group</li> : matches.map((group) => <li key={group.id}><button type="button" onClick={() => { onPick(group.id); setOpen(false); setQuery(''); }}>{group.name}</button></li>)}</ul>
    </div>}
  </div>;
}

/** Groups to compare: toggled chips for the first few groups, a searchable picker for the rest. */
export function GroupToggles({ groups, selected, colorOf, onChange }: { groups: Option[]; selected: number[]; colorOf: (id: number) => string; onChange: (ids: number[]) => void }) {
  if (groups.length === 0) return null;
  const full = selected.length >= MAX_COMPARED_GROUPS;
  const chips = groups.length <= MAX_GROUP_CHIPS ? groups : groups.filter((group) => selected.includes(group.id));
  const pickable = groups.length <= MAX_GROUP_CHIPS ? [] : groups.filter((group) => !selected.includes(group.id));
  const toggle = (id: number) => onChange(selected.includes(id) ? selected.filter((item) => item !== id) : full ? selected : [...selected, id]);
  return <div className="reports-group-toggles" aria-label="Compare groups">
    <span className="reports-filter-label">Compare</span>
    {chips.map((group) => {
      const active = selected.includes(group.id);
      return <button key={group.id} type="button" aria-pressed={active} disabled={!active && full} title={!active && full ? `Up to ${MAX_COMPARED_GROUPS} groups can be compared` : undefined} className={`reports-group-chip${active ? ' is-active' : ''}`} style={active ? { borderColor: colorOf(group.id) } : undefined} onClick={() => toggle(group.id)}>
        <span className="reports-group-dot" style={{ background: active ? colorOf(group.id) : undefined }} aria-hidden="true" />{group.name}{active && groups.length > MAX_GROUP_CHIPS && <X size={13} aria-hidden="true" />}
      </button>;
    })}
    {pickable.length > 0 && !full && <GroupPicker groups={pickable} onPick={(id) => onChange([...selected, id])} />}
    {selected.length > 0 && <button type="button" className="reports-group-clear" onClick={() => onChange([])}>All groups</button>}
  </div>;
}

import { useEffect, useRef, useState } from 'react';
import { ChevronDown, Plus, X } from 'lucide-react';
import { GROUP_NOUN, type Noun } from '../reports.utils';

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

function GroupPicker({ groups, onPick, noun }: { groups: Option[]; onPick: (id: number) => void; noun: Noun }) {
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
    <button type="button" className="reports-group-add" aria-expanded={open} onClick={() => setOpen((value) => !value)}><Plus size={14} aria-hidden="true" />{noun.One}</button>
    {open && <div className="reports-group-menu" role="dialog" aria-label={`Add ${noun.one}`} onKeyDown={(event) => { if (event.key === 'Escape') setOpen(false); }}>
      <input autoFocus type="search" placeholder={`Search ${noun.many}`} aria-label={`Search ${noun.many}`} value={query} onChange={(event) => setQuery(event.target.value)} />
      <ul>{matches.length === 0 ? <li className="reports-group-menu-empty">No matching {noun.one}</li> : matches.map((group) => <li key={group.id}><button type="button" onClick={() => { onPick(group.id); setOpen(false); setQuery(''); }}>{group.name}</button></li>)}</ul>
    </div>}
  </div>;
}

/** Groups (or roles) to compare: toggled chips for the first few, a searchable picker for the rest. */
export function GroupToggles({ groups, selected, colorOf, onChange, noun = GROUP_NOUN }: { groups: Option[]; selected: number[]; colorOf: (id: number) => string; onChange: (ids: number[]) => void; noun?: Noun }) {
  if (groups.length === 0) return null;
  const full = selected.length >= MAX_COMPARED_GROUPS;
  const chips = groups.length <= MAX_GROUP_CHIPS ? groups : groups.filter((group) => selected.includes(group.id));
  const pickable = groups.length <= MAX_GROUP_CHIPS ? [] : groups.filter((group) => !selected.includes(group.id));
  const toggle = (id: number) => onChange(selected.includes(id) ? selected.filter((item) => item !== id) : full ? selected : [...selected, id]);
  return <div className="reports-group-toggles" aria-label={`Compare ${noun.many}`}>
    <span className="reports-filter-label">Compare</span>
    {chips.map((group) => {
      const active = selected.includes(group.id);
      return <button key={group.id} type="button" aria-pressed={active} disabled={!active && full} title={!active && full ? `Up to ${MAX_COMPARED_GROUPS} ${noun.many} can be compared` : undefined} className={`reports-group-chip${active ? ' is-active' : ''}`} style={active ? { borderColor: colorOf(group.id) } : undefined} onClick={() => toggle(group.id)}>
        <span className="reports-group-dot" style={{ background: active ? colorOf(group.id) : undefined }} aria-hidden="true" />{group.name}{active && groups.length > MAX_GROUP_CHIPS && <X size={13} aria-hidden="true" />}
      </button>;
    })}
    {pickable.length > 0 && !full && <GroupPicker groups={pickable} noun={noun} onPick={(id) => onChange([...selected, id])} />}
    {selected.length > 0 && <button type="button" className="reports-group-clear" onClick={() => onChange([])}>{noun.all}</button>}
  </div>;
}

/** Compare the campaign by assignment groups or by the evaluated employees' company roles. */
export function DimensionSwitch({ value, onChange }: { value: 'groups' | 'roles'; onChange: (value: 'groups' | 'roles') => void }) {
  return <div className="reports-dimension-switch" role="group" aria-label="Compare by">
    {(['groups', 'roles'] as const).map((item) => <button key={item} type="button" aria-pressed={value === item} className={value === item ? 'is-active' : ''} onClick={() => onChange(item)}>{item === 'groups' ? 'Groups' : 'Roles'}</button>)}
  </div>;
}

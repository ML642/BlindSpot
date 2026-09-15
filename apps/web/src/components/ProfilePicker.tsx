import { profiles, type ProfileId } from '@blindspot/shared';
import { Icon } from './Icon';

const groups = [...new Set(profiles.map((profile) => profile.group))];

export function ProfilePicker({ selected, onChange }: { selected: ProfileId[]; onChange: (next: ProfileId[]) => void }) {
  const allSelected = selected.length === profiles.length;
  const toggle = (id: ProfileId) => onChange(selected.includes(id) ? selected.filter((value) => value !== id) : [...selected, id]);
  const toggleAll = () => onChange(allSelected ? [] : profiles.map((profile) => profile.id));
  return (
    <fieldset className="profile-fieldset">
      <legend className="sr-only">Accessibility profiles</legend>
      <div className="profile-heading">
        <div><p className="field-label">User profiles</p><p className="field-help">Choose whose experience the audit should model. Each profile fixes what the agent may perceive.</p></div>
        <button type="button" className="select-all" onClick={toggleAll} aria-pressed={allSelected}>{allSelected ? 'Clear all' : 'Select all'}</button>
      </div>
      <div className="profile-groups">
        {groups.map((group) => <div className="profile-group" key={group}><p className="profile-group-title">{group}</p><div className="profile-options">
          {profiles.filter((profile) => profile.group === group).map((profile) => {
            const isSelected = selected.includes(profile.id);
            return <label className={`profile-option ${isSelected ? 'is-selected' : ''}`} key={profile.id}>
              <input type="checkbox" checked={isSelected} onChange={() => toggle(profile.id)} />
              <span className="checkbox-box" aria-hidden="true">{isSelected && <Icon name="check" size={13} />}</span>
              <span className="profile-copy"><span>{profile.name}</span><small>{profile.description}</small><small className="profile-lens">Agent sees: {profile.lens}</small></span>
            </label>;
          })}
        </div></div>)}
      </div>
      <p className={`selection-count ${selected.length === 0 ? 'is-error' : ''}`} aria-live="polite">{selected.length} of {profiles.length} profiles selected</p>
    </fieldset>
  );
}

import './ContributorFields.css';

export interface ContributorFieldsProps {
  name: string;
  story: string;
  onNameChange: (value: string) => void;
  onStoryChange: (value: string) => void;
  disabled: boolean;
}

const NAME_MAX = 100;
const STORY_MAX = 2000;

export function ContributorFields({
  name,
  story,
  onNameChange,
  onStoryChange,
  disabled,
}: ContributorFieldsProps) {
  const nameId = 'contributor-name';
  const storyId = 'contributor-story';

  return (
    <div className="contributor-fields">
      <div className="contributor-fields__group">
        <label className="contributor-fields__label" htmlFor={nameId}>Your name (optional)</label>
        <input
          id={nameId}
          className="contributor-fields__input"
          type="text"
          maxLength={NAME_MAX}
          value={name}
          onChange={(e) => onNameChange(e.target.value)}
          disabled={disabled}
        />
        <span className="contributor-fields__count">
          {name.length}/{NAME_MAX}
        </span>
      </div>

      <div className="contributor-fields__group">
        <label className="contributor-fields__label" htmlFor={storyId}>Your garden story (optional)</label>
        <textarea
          id={storyId}
          className="contributor-fields__textarea"
          maxLength={STORY_MAX}
          value={story}
          onChange={(e) => onStoryChange(e.target.value)}
          disabled={disabled}
          rows={2}
        />
        <span className="contributor-fields__count">
          {story.length}/{STORY_MAX}
        </span>
      </div>
    </div>
  );
}

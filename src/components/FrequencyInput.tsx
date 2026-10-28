/**
 * @file src/components/FrequencyInput.tsx
 * @description MHz text field that keeps a local draft while typing and commits only on
 * blur or Enter (Escape cancels), so partial input such as "1" or "146." never reaches the codeplug.
 */

import React, { useRef, useState } from 'react';
import { formatMhzInput, parseMhzInput } from '../core/channelEdit';

interface FrequencyInputProps {
  /** Current frequency in Hz; `0` or less shows an empty field. */
  valueHz: number;
  /** Called after editing with a valid frequency that differs from `valueHz`. */
  onCommit: (hz: number) => void;
  className?: string;
  placeholder?: string;
  ariaLabel?: string;
}

export const FrequencyInput: React.FC<FrequencyInputProps> = ({
  valueHz,
  onCommit,
  className,
  placeholder = '—',
  ariaLabel,
}) => {
  const formatted = formatMhzInput(valueHz);
  // `null` while not editing, so the field always shows the committed value.
  const [draft, setDraft] = useState<string | null>(null);
  const cancelRef = useRef(false);

  const finishEditing = () => {
    const text = draft;
    setDraft(null);
    if (cancelRef.current || text === null) {
      cancelRef.current = false;
      return;
    }
    const hz = parseMhzInput(text);
    if (hz !== null && hz !== valueHz) {
      onCommit(hz);
    }
  };

  return (
    <input
      type="text"
      inputMode="decimal"
      autoComplete="off"
      spellCheck={false}
      aria-label={ariaLabel}
      value={draft ?? formatted}
      placeholder={placeholder}
      onFocus={(e) => {
        setDraft(formatted);
        e.currentTarget.select();
      }}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={finishEditing}
      onKeyDown={(e) => {
        if (e.key === 'Enter') {
          e.currentTarget.blur();
        } else if (e.key === 'Escape') {
          cancelRef.current = true;
          e.currentTarget.blur();
        }
      }}
      className={className}
    />
  );
};

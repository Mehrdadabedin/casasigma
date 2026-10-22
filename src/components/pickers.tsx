import type { ReactNode } from 'react';
import { formatDay } from '../lib/format';
import { useI18n } from '../state/LanguageProvider';

export function DayPicker({
  days,
  selected,
  onSelect,
}: {
  days: string[];
  selected: string;
  onSelect: (day: string) => void;
}) {
  const { t, locale } = useI18n();

  return (
    <div className="daypicker" role="group" aria-label={t('pickers.day')}>
      {days.map((day) => {
        const label = formatDay(day, locale);
        return (
          <button
            key={day}
            type="button"
            className={`daypicker__day ${day === selected ? 'is-active' : ''}`}
            onClick={() => onSelect(day)}
            aria-pressed={day === selected}
          >
            <span className="daypicker__weekday">{label.split(' ')[0]}</span>
            <span className="daypicker__date">{label.split(' ').slice(1).join(' ')}</span>
          </button>
        );
      })}
    </div>
  );
}

export function TimeSlots({
  times,
  selected,
  onSelect,
  isTaken,
}: {
  times: string[];
  selected: string;
  onSelect: (time: string) => void;
  isTaken: (time: string) => boolean;
}) {
  const { t } = useI18n();

  return (
    <div className="slots" role="group" aria-label={t('pickers.time')}>
      {times.map((time) => {
        const taken = isTaken(time);
        return (
          <button
            key={time}
            type="button"
            disabled={taken}
            className={`slot ${time === selected ? 'is-active' : ''}`}
            onClick={() => onSelect(time)}
            aria-pressed={time === selected}
            title={taken ? t('pickers.takenTitle') : undefined}
          >
            {time}
            {taken && <span className="slot__taken">{t('pickers.taken')}</span>}
          </button>
        );
      })}
    </div>
  );
}

export function EmptyState({
  title,
  body,
  action,
}: {
  title: string;
  body: string;
  action?: ReactNode;
}) {
  return (
    <div className="empty">
      <span className="empty__mark" aria-hidden="true">
        ◍
      </span>
      <h3>{title}</h3>
      <p>{body}</p>
      {action}
    </div>
  );
}

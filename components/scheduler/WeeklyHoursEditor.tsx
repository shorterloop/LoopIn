'use client'

import type {Weekday, WeeklyHours} from '@/lib/scheduler/types'
import {FiX} from 'react-icons/fi'
import styles from './WeeklyHoursEditor.module.css'

const DAYS: Array<[Weekday, string]> = [
  ['mon', 'Monday'], ['tue', 'Tuesday'], ['wed', 'Wednesday'], ['thu', 'Thursday'],
  ['fri', 'Friday'], ['sat', 'Saturday'], ['sun', 'Sunday'],
]

export default function WeeklyHoursEditor({value, onChange}: {value: WeeklyHours; onChange: (hours: WeeklyHours) => void}) {
  function setDay(day: Weekday, ranges: Array<[string, string]>) {
    onChange({...value, [day]: ranges})
  }

  return <div className={styles.days}>
    {DAYS.map(([day, label]) => {
      const ranges = value[day] ?? []
      return <div className={styles.day} key={day}>
        <label className={styles.dayName}>
          <input type="checkbox" checked={ranges.length > 0} onChange={(event) => setDay(day, event.target.checked ? [['09:00', '17:00']] : [])} />
          {label}
        </label>
        <div className={styles.ranges}>
          {ranges.map(([start, end], index) => <div className={styles.range} key={`${day}-${index}`}>
            <input type="time" aria-label={`${label} start ${index + 1}`} value={start} onChange={(event) => setDay(day, ranges.map((range, i) => i === index ? [event.target.value, end] : range))} />
            <span>to</span>
            <input type="time" aria-label={`${label} end ${index + 1}`} value={end} onChange={(event) => setDay(day, ranges.map((range, i) => i === index ? [start, event.target.value] : range))} />
            <button type="button" className={styles.iconButton} title="Remove hours" aria-label={`Remove ${label} hours ${index + 1}`} onClick={() => setDay(day, ranges.filter((_, i) => i !== index))}><FiX aria-hidden="true" /></button>
          </div>)}
          {ranges.length > 0 && <button className={styles.add} type="button" onClick={() => setDay(day, [...ranges, ['13:00', '17:00']])}>Add hours</button>}
        </div>
      </div>
    })}
  </div>
}

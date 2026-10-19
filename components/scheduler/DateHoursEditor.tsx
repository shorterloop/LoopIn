'use client'

import {FiX} from 'react-icons/fi'
import styles from './DateHoursEditor.module.css'

type Hours = Array<[string, string]>

export default function DateHoursEditor({value, onChange}: {value: Hours; onChange: (value: Hours) => void}) {
  function change(index: number, part: 0 | 1, time: string) {
    onChange(value.map((range, position) => position === index
      ? (part === 0 ? [time, range[1]] : [range[0], time]) as [string, string]
      : range))
  }

  return <div className={styles.editor}>
    <label className={styles.closed}>
      <input type="checkbox" checked={value.length === 0} onChange={(event) => onChange(event.target.checked ? [] : [['09:00', '17:00']])} />
      Closed all day
    </label>
    {value.map((range, index) => <div className={styles.range} key={index}>
      <input type="time" aria-label={`Start ${index + 1}`} value={range[0]} onChange={(event) => change(index, 0, event.target.value)} />
      <span>to</span>
      <input type="time" aria-label={`End ${index + 1}`} value={range[1]} onChange={(event) => change(index, 1, event.target.value)} />
      <button type="button" aria-label={`Remove hours ${index + 1}`} title="Remove hours" onClick={() => onChange(value.filter((_, position) => position !== index))}><FiX aria-hidden="true" /></button>
    </div>)}
    {value.length > 0 && <button className={styles.add} type="button" onClick={() => onChange([...value, ['09:00', '17:00']])}>Add hours</button>}
  </div>
}

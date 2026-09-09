import { useEffect, useState } from 'react'

/** Live transcript: what you said, what she answers. Fades away once she has finished. */
export default function Captions({ userText, assistantText, hold }: { userText: string; assistantText: string; hold: boolean }) {
  const [faded, setFaded] = useState(false)
  const [seen, setSeen] = useState({ userText, assistantText, hold })

  // New text (or renewed speech) un-fades immediately, adjusted during render.
  if (seen.userText !== userText || seen.assistantText !== assistantText || seen.hold !== hold) {
    setSeen({ userText, assistantText, hold })
    if (faded) setFaded(false)
  }

  useEffect(() => {
    // While she is still thinking or speaking the lines stay; the fade timer
    // starts once the reply is done (and restarts on any new text).
    if (hold || (!userText && !assistantText)) return
    const timer = setTimeout(() => setFaded(true), 5000)
    return () => clearTimeout(timer)
  }, [userText, assistantText, hold])

  return (
    <div className={`captions${faded ? ' faded' : ''}`} aria-live="polite">
      {userText && <p className="caption user">{userText}</p>}
      {assistantText && <p className="caption viki">{assistantText}</p>}
    </div>
  )
}

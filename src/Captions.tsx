/** Live transcript: what you said, what she answers. */
export default function Captions({ userText, assistantText }: { userText: string; assistantText: string }) {
  return (
    <div className="captions" aria-live="polite">
      {userText && <p className="caption user">{userText}</p>}
      {assistantText && <p className="caption viki">{assistantText}</p>}
    </div>
  )
}

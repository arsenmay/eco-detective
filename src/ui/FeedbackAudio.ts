/** Tiny original sound cues, generated locally; enabled only by the player. */
export class FeedbackAudio {
  private context: AudioContext | null = null;
  private enabled = false;

  setEnabled(enabled: boolean): void { this.enabled = enabled; }

  play(cue: 'clue' | 'success' | 'retry' | 'apply'): void {
    if (!this.enabled || document.hidden) return;
    try {
      this.context ??= new AudioContext();
      const context = this.context;
      if (context.state === 'suspended') void context.resume().catch(() => undefined);
      const notes = cue === 'retry' ? [330, 294] : cue === 'clue' ? [523, 784] : cue === 'apply' ? [440, 659, 880] : [523, 659, 784, 1047];
      notes.forEach((frequency, index) => {
        const oscillator = context.createOscillator();
        const gain = context.createGain();
        const start = context.currentTime + index * .09;
        oscillator.type = 'sine';
        oscillator.frequency.value = frequency;
        gain.gain.setValueAtTime(0, start);
        gain.gain.linearRampToValueAtTime(.055, start + .012);
        gain.gain.exponentialRampToValueAtTime(.001, start + .18);
        oscillator.connect(gain); gain.connect(context.destination);
        oscillator.start(start); oscillator.stop(start + .2);
        oscillator.onended = () => { oscillator.disconnect(); gain.disconnect(); };
      });
    } catch { /* Sound support never blocks the investigation. */ }
  }
}

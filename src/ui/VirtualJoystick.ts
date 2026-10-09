import { getJoystickKnobOffset, getJoystickVector, normalizeJoystickSensitivity } from './joystickMath';
import type { JoystickVector } from './joystickMath';

/** A fixed thumbstick that captures one finger without blocking the interaction button. */
export class VirtualJoystick {
  private readonly knob: HTMLElement;
  private readonly previousTouchAction: string;
  private readonly previousKnobTransform: string;
  private readonly previousDescription: string | null;
  private activePointer: number | null = null;
  private sensitivity: number;
  private lastClientPosition: JoystickVector | null = null;
  private destroyed = false;

  constructor(
    private readonly element: HTMLElement,
    private readonly onVector: (vector: JoystickVector) => void,
    sensitivity = 1,
  ) {
    const knob = element.querySelector<HTMLElement>('.joystick-knob');
    if (!knob) throw new Error('VirtualJoystick requires a .joystick-knob element.');
    this.knob = knob;
    this.sensitivity = normalizeJoystickSensitivity(sensitivity);
    this.previousTouchAction = element.style.touchAction;
    this.previousKnobTransform = knob.style.transform;
    this.previousDescription = element.getAttribute('aria-description');
    element.style.touchAction = 'none';
    if (!this.previousDescription) {
      element.setAttribute('aria-description', 'Удерживайте и двигайте джойстик для перемещения персонажа.');
    }
    this.paintKnob({ x: 0, y: 0 });
    element.addEventListener('pointerdown', this.handlePointerDown);
    element.addEventListener('pointermove', this.handlePointerMove);
    element.addEventListener('pointerup', this.handlePointerEnd);
    element.addEventListener('pointercancel', this.handlePointerEnd);
    element.addEventListener('lostpointercapture', this.handlePointerEnd);
    window.addEventListener('blur', this.handleInterruption);
    window.addEventListener('resize', this.handleInterruption);
    document.addEventListener('visibilitychange', this.handleVisibilityChange);
  }

  setSensitivity(sensitivity: number): void {
    this.sensitivity = normalizeJoystickSensitivity(sensitivity);
    if (!this.destroyed && this.activePointer !== null && this.lastClientPosition) {
      this.updateFromPosition(this.lastClientPosition.x, this.lastClientPosition.y);
    }
  }

  /** Also call this when opening a game modal or returning to the menu. */
  reset(): void {
    if (this.destroyed) return;
    const pointer = this.activePointer;
    // Clear state before release: lostpointercapture may arrive immediately.
    this.activePointer = null;
    this.lastClientPosition = null;
    if (pointer !== null) {
      try {
        if (this.element.hasPointerCapture(pointer)) this.element.releasePointerCapture(pointer);
      } catch { /* An interrupted gesture can already have lost browser capture. */ }
    }
    this.element.classList.remove('engaged');
    this.paintKnob({ x: 0, y: 0 });
    this.onVector({ x: 0, y: 0 });
  }

  destroy(): void {
    if (this.destroyed) return;
    this.reset();
    this.destroyed = true;
    this.element.removeEventListener('pointerdown', this.handlePointerDown);
    this.element.removeEventListener('pointermove', this.handlePointerMove);
    this.element.removeEventListener('pointerup', this.handlePointerEnd);
    this.element.removeEventListener('pointercancel', this.handlePointerEnd);
    this.element.removeEventListener('lostpointercapture', this.handlePointerEnd);
    window.removeEventListener('blur', this.handleInterruption);
    window.removeEventListener('resize', this.handleInterruption);
    document.removeEventListener('visibilitychange', this.handleVisibilityChange);
    this.element.style.touchAction = this.previousTouchAction;
    this.knob.style.transform = this.previousKnobTransform;
    if (this.previousDescription === null) this.element.removeAttribute('aria-description');
    else this.element.setAttribute('aria-description', this.previousDescription);
  }

  private readonly handlePointerDown = (event: PointerEvent): void => {
    if (this.activePointer !== null || (event.pointerType === 'mouse' && event.button !== 0)) return;
    this.activePointer = event.pointerId;
    try {
      this.element.setPointerCapture(event.pointerId);
    } catch {
      this.reset();
      return;
    }
    if (event.cancelable) event.preventDefault();
    this.element.classList.add('engaged');
    this.updateFromPosition(event.clientX, event.clientY);
  };

  private readonly handlePointerMove = (event: PointerEvent): void => {
    if (event.pointerId !== this.activePointer) return;
    if (event.cancelable) event.preventDefault();
    this.updateFromPosition(event.clientX, event.clientY);
  };

  private readonly handlePointerEnd = (event: PointerEvent): void => {
    if (event.pointerId === this.activePointer) this.reset();
  };

  private readonly handleInterruption = (): void => { this.reset(); };

  private readonly handleVisibilityChange = (): void => {
    if (document.hidden) this.reset();
  };

  private updateFromPosition(clientX: number, clientY: number): void {
    this.lastClientPosition = { x: clientX, y: clientY };
    const base = this.element.getBoundingClientRect();
    const knob = this.knob.getBoundingClientRect();
    const radius = Math.max(0, Math.min(base.width, base.height) / 2 - Math.max(knob.width, knob.height) / 2);
    const deltaX = clientX - base.left - base.width / 2;
    const deltaY = clientY - base.top - base.height / 2;
    this.paintKnob(getJoystickKnobOffset(deltaX, deltaY, radius));
    this.onVector(getJoystickVector(deltaX, deltaY, radius, this.sensitivity));
  }

  private paintKnob(offset: JoystickVector): void {
    this.knob.style.transform = `translate(-50%, -50%) translate3d(${offset.x}px, ${offset.y}px, 0)`;
  }
}

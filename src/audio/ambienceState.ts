/** Timers of the outdoor ambience (audio/SoundScape.tsx > ambience); kept separate so the component file exports only components */
export const amb = { carAt: 0, visitorCallAt: 0, lastVisitor: '', owlAt: 0, dogAt: 0 }

/** Tests and debugging: night sounds right away (owl, distant dog) */
export const ambienceDebug = {
  callNow: () => {
    amb.owlAt = 0
    amb.dogAt = 0
  },
}

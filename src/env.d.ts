declare namespace App {
  interface Locals {}
}
declare module 'virtual:pack' {
  const pack: import('./pack/types').Pack;
  export default pack;
}
declare module 'virtual:pack-bank' {
  const bank: import('./pack/types').Bank;
  export default bank;
}

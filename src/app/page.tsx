export default function Home() {
  return (
    <div className="flex flex-col flex-1 items-center justify-center bg-black font-sans text-white">
      <main className="flex flex-1 w-full max-w-2xl flex-col items-center justify-center px-6 py-32 text-center">
        <h1 className="text-5xl font-semibold tracking-tight sm:text-6xl">
          AfterSound
        </h1>
        <p className="mt-6 max-w-md text-lg leading-8 text-zinc-400">
          You can&apos;t hear the damage happening. Now you can.
        </p>
      </main>
    </div>
  );
}

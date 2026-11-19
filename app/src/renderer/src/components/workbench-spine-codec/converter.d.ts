interface Converter {
  HEAPU8: Uint8Array
  _malloc(size: number): number
  _free(pointer: number): void
  _st_convert(
    input: number,
    length: number,
    from: number,
    to: number,
    version: number,
    removeCurves: number
  ): number
  _st_output_data(): number
  _st_output_size(): number
  _st_last_error(): number
  UTF8ToString(pointer: number): string
}
export default function create(options: { locateFile(path: string): string }): Promise<Converter>

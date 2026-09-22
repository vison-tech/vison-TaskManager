export type FlagValue = string | true;

export type ParsedArgs = {
  positionals: string[];
  flags: Map<string, FlagValue>;
  json: boolean;
};

export type Output = {
  stdout: { write(value: string): void };
  stderr: { write(value: string): void };
};

export class CliError extends Error {
  constructor(message: string, readonly exitCode = 2) {
    super(message);
    this.name = 'CliError';
  }
}

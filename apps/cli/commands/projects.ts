import type { TaskClient } from '../../../packages/client/index.ts';
import { flag, labelsFlag, numberFlag, positional, projectFields, requireNoExtraPositionals } from '../core/args.ts';
import type { ParsedArgs } from '../core/types.ts';
import { CliError } from '../core/types.ts';

export async function projectCommand(args: ParsedArgs, client: TaskClient): Promise<unknown> {
  const action = positional(args.positionals[1], 'project command');
  switch (action) {
    case 'list': requireNoExtraPositionals(args, 2); return client.listProjects();
    case 'get': {
      const id = positional(args.positionals[2], 'project id'); requireNoExtraPositionals(args, 3);
      const project = (await client.listProjects()).find((item) => item.id === id || item.prefix === id);
      if (!project) throw new CliError(`Project not found: ${id}`, 1);
      return project;
    }
    case 'create': {
      requireNoExtraPositionals(args, 2); const name = flag(args, 'name', true);
      return client.createProject({ name: name!, prefix: flag(args, 'prefix'), workspacePath: flag(args, 'workspace-path'), labels: labelsFlag(args), readme: flag(args, 'readme') });
    }
    case 'update': {
      const id = positional(args.positionals[2], 'project id'); requireNoExtraPositionals(args, 3);
      const fields = projectFields(args, true); if (Object.keys(fields).length === 1) throw new CliError('At least one project field is required');
      return client.updateProject(id, fields as Parameters<TaskClient['updateProject']>[1]);
    }
    case 'readme': {
      const id = positional(args.positionals[2], 'project id'); requireNoExtraPositionals(args, 3);
      const body = flag(args, 'body', true); const version = numberFlag(args, 'version', true);
      return client.updateProject(id, { version: version!, readme: body! });
    }
    case 'delete': {
      const id = positional(args.positionals[2], 'project id'); requireNoExtraPositionals(args, 3);
      await client.deleteProject(id, numberFlag(args, 'version', true)!); return { ok: true, deleted: id };
    }
    default: throw new CliError(`Unknown project command: ${action}`);
  }
}

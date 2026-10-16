import { FileBasedTemplateLoader, LoadTemplateInput, TemplateLoader } from '@vendure/email-plugin';
import { Injector, RequestContext } from '@vendure/core';
import fs from 'node:fs/promises';
import path from 'node:path';

export class MarketplaceTemplateLoader implements TemplateLoader {
    private fallbackLoader: FileBasedTemplateLoader;

    constructor(
        private marketplaceTemplatePath: string,
        fallbackTemplatePath: string,
    ) {
        this.fallbackLoader = new FileBasedTemplateLoader(fallbackTemplatePath);
    }

    async loadTemplate(
        injector: Injector,
        ctx: RequestContext,
        input: LoadTemplateInput,
    ): Promise<string> {
        const localPath = path.join(this.marketplaceTemplatePath, input.type, input.templateName);
        try {
            return await fs.readFile(localPath, 'utf8');
        } catch (error) {
            if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
            return this.fallbackLoader.loadTemplate(injector, ctx, input);
        }
    }

    loadPartials() {
        return this.fallbackLoader.loadPartials();
    }
}

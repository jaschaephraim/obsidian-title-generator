import {
  App,
  Editor,
  Notice,
  Plugin,
  PluginSettingTab,
  Setting,
  TFile,
  normalizePath,
} from 'obsidian';
import OpenAI from 'openai';
import pMap from 'p-map';
import path from 'path-browserify';

interface TitleGeneratorSettings {
  openAiApiKey: string;
  lowerCaseTitles: boolean;
}

const DEFAULT_SETTINGS: TitleGeneratorSettings = {
  openAiApiKey: '',
  lowerCaseTitles: false,
  acceptSubtitles: false,
};

class TitleGeneratorSettingTab extends PluginSettingTab {
  plugin: TitleGeneratorPlugin;

  constructor(app: App, plugin: TitleGeneratorPlugin) {
    super(app, plugin);
    this.plugin = plugin;
  }

  display(): void {
    const { containerEl } = this;
    containerEl.empty();

    new Setting(containerEl)
      .setName('OpenAI API key')
      .addText((text) => {
        text.inputEl.type = 'password';
        text.inputEl.style.width = '100%';
        text
          .setPlaceholder('API Key')
          .setValue(this.plugin.settings.openAiApiKey)
          .onChange(async (newValue) => {
            this.plugin.settings.openAiApiKey = newValue;
            await this.plugin.saveSettings();
          });
      });

    new Setting(containerEl)
      .setName('Lower-case titles')
      .addToggle((toggle) => {
        toggle
          .setValue(this.plugin.settings.lowerCaseTitles)
          .onChange(async (newValue) => {
            this.plugin.settings.lowerCaseTitles = newValue;
            await this.plugin.saveSettings();
          });
      });

    new Setting(containerEl)
      .setName('Accept sub-titles')
      .addToggle((toggle) => {
        toggle
          .setValue(this.plugin.settings.acceptSubtitles)
          .onChange(async (newValue) => {
            this.plugin.settings.acceptSubtitles = newValue;
            await this.plugin.saveSettings();
          });
      });
  }
}

export default class TitleGeneratorPlugin extends Plugin {
  settings: TitleGeneratorSettings;

  openai: OpenAI;

  private async generateTitle(file: TFile, content: string) {
    const loadingStatus = this.addStatusBarItem();
    loadingStatus.createEl('span', { text: 'Generating title...' });

    try {
      let prevTitle = file.basename.toLowerCase();
      let title = prevTitle;
      
      for (let i = 0; (i < 3 && title.toLowerCase() == prevTitle); i++) {
        let response = await this.openai.chat.completions.create({
          model: "gpt-3.5-turbo-1106",
          messages: [{role: "system", content: "You are a function for giving titles to texts. You receive a text and output a succint and descriptive title for that text. Your reply consists in this title, and nothing else. Your reply does not contain question marks. Your reply does not contain slashes or backslashes. You always reply in the user's language."},
                     {role: "user", content: content}],
          max_tokens: 48
        });
		  
        title = response.choices[0].message.content;
        title = title.replace(/(\.$|["<>\?\*\/\\])/g, '');
	      
        if (this.settings.acceptSubtitles) {
          title = title.replace(/:/g, " - ");
        } else {
          title = title.replace(/:.*/g, "");
        }
	      
        title = title.replace(/  +/g, " ").trim();
      }
	  
      if (this.settings.lowerCaseTitles) {
        title = title.toLowerCase();
      }
      
      const currentPath = path.parse(file.path);
      const newPath = normalizePath(
        `${currentPath.dir}/${title}${currentPath.ext}`
      );

      await this.app.fileManager.renameFile(file, newPath);
    } catch (err) {
      new Notice(`Unable to generate title:\n\n${err}`);
    } finally {
      loadingStatus.remove();
    }
  }

  private async generateTitleFromFile(file: TFile) {
    const content = await file.vault.cachedRead(file);
    return this.generateTitle(file, content);
  }

  private async generateTitleFromEditor(editor: Editor) {
    const activeFile = this.app.workspace.getActiveFile();
    if (!activeFile) {
      throw new Error('No active file');
    }

    const content = editor.getValue();
    this.generateTitle(activeFile, content);
  }

  async onload() {
    await this.loadSettings();

    this.openai = new OpenAI({
      apiKey: this.settings.openAiApiKey,
      dangerouslyAllowBrowser: true,
    });

    this.addCommand({
      id: 'title-generator-generate-title',
      name: 'Generate title',
      editorCallback: (editor) => this.generateTitleFromEditor(editor),
    });

    this.registerEvent(
      this.app.workspace.on('file-menu', (menu, file) => {
        if (!(file instanceof TFile)) {
          return;
        }

        menu.addItem((item) => {
          item
            .setTitle('Generate title')
            .setIcon('lucide-edit-3')
            .onClick(() => this.generateTitleFromFile(file));
        });
      })
    );

    this.registerEvent(
      this.app.workspace.on('files-menu', (menu, files) => {
        const tFiles = files.filter((f) => f instanceof TFile) as TFile[];
        if (tFiles.length < 1) {
          return;
        }

        menu.addItem((item) => {
          item
            .setTitle('Generate titles')
            .setIcon('lucide-edit-3')
            .onClick(() =>
              pMap<TFile, void>(tFiles, (f) => this.generateTitleFromFile(f), {
                concurrency: 1,
              })
            );
        });
      })
    );

    this.addSettingTab(new TitleGeneratorSettingTab(this.app, this));
  }

  async loadSettings() {
    this.settings = { ...DEFAULT_SETTINGS, ...(await this.loadData()) };
  }

  async saveSettings() {
    await this.saveData(this.settings);
    this.openai.apiKey = this.settings.openAiApiKey;
  }
}

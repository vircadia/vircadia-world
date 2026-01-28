import React, { useState, useEffect } from 'react';
import { Box, Text, useInput, useApp } from 'ink';
import SelectInput from 'ink-select-input';
import TextInput from 'ink-text-input';
import Spinner from 'ink-spinner';
import Gradient from 'ink-gradient';
import BigText from 'ink-big-text';

type Config = {
    env: 'local' | 'prod' | null;
    domain: string;
    tlsMode: string;
};

interface DeployProps {
    onConfigComplete: (config: Config) => Promise<void>;
}

export const Deploy: React.FC<DeployProps> = ({ onConfigComplete }) => {
    const { exit } = useApp();
    const [step, setStep] = useState<'select-env' | 'enter-domain' | 'confirm' | 'deploying' | 'success'>('select-env');
    const [config, setConfig] = useState<Config>({ env: null, domain: '', tlsMode: '' });
    const [log, setLog] = useState<string>('');

    const handleEnvSelect = (item: { label: string; value: 'local' | 'prod' }) => {
        if (item.value === 'local') {
            setConfig({ env: 'local', domain: 'http://localhost', tlsMode: '' });
            setStep('confirm');
        } else {
            setConfig({ ...config, env: 'prod' });
            setStep('enter-domain');
        }
    };

    const handleDomainSubmit = (domain: string) => {
        let cleanDomain = domain.trim();
        // Remove protocol if user typed it
        cleanDomain = cleanDomain.replace(/^https?:\/\//, '');
        
        setConfig({ 
            ...config, 
            domain: cleanDomain, 
            tlsMode: 'auto' // Default to auto (Let's Encrypt) for prod
        });
        setStep('confirm');
    };

    const startDeployment = async () => {
        setStep('deploying');
        try {
            await onConfigComplete(config);
            setStep('success');
            setTimeout(() => {
                exit();
            }, 2000);
        } catch (e) {
            setLog(`Error: ${e}`);
            // Keep in deploying state but show error? Or new error state?
        }
    };

    useInput((input, key) => {
         if (step === 'confirm' && key.return) {
             startDeployment();
         }
    });

    return (
        <Box flexDirection="column" padding={1}>
            <Box marginBottom={1}>
                {/* @ts-ignore: ink-gradient types might be loose */}
                <Gradient name="morning">
                    <BigText text="Vircadia Deploy" font="tiny" />
                </Gradient>
            </Box>

            {step === 'select-env' && (
                <Box flexDirection="column">
                    <Text bold>Select Deployment Environment:</Text>
                    <SelectInput
                        items={[
                            { label: 'Local Development (HTTP, localhost)', value: 'local' },
                            { label: 'Production (HTTPS, Public Domain)', value: 'prod' }
                        ]}
                        onSelect={handleEnvSelect}
                    />
                </Box>
            )}

            {step === 'enter-domain' && (
                <Box flexDirection="column">
                    <Text bold>Enter Domain Name (e.g., example.com):</Text>
                    <Box borderStyle="round" padding={1}>
                        <TextInput
                            value={config.domain}
                            onChange={(val) => setConfig({ ...config, domain: val })}
                            onSubmit={handleDomainSubmit}
                        />
                    </Box>
                </Box>
            )}

            {step === 'confirm' && (
                <Box flexDirection="column">
                    <Text bold underline>Configuration Summary:</Text>
                    <Box marginY={1} flexDirection="column">
                        <Text>Environment: <Text color="cyan">{config.env === 'local' ? 'Local Development' : 'Production'}</Text></Text>
                        <Text>Domain: <Text color="green">{config.domain}</Text></Text>
                        <Text>TLS Mode: <Text color="yellow">{config.tlsMode || 'Disabled (HTTP)'}</Text></Text>
                    </Box>
                    <Text>Press <Text bold color="blue">Enter</Text> to start deployment...</Text>
                </Box>
            )}

            {step === 'deploying' && (
                <Box flexDirection="column">
                    <Text><Text color="green"><Spinner type="dots" /></Text> Deploying containers...</Text>
                    {log && <Text color="red">{log}</Text>}
                </Box>
            )}

            {step === 'success' && (
                <Box flexDirection="column">
                     <Text color="green" bold>✔ Deployment Initiated Successfully!</Text>
                     <Text>Exiting...</Text>
                </Box>
            )}
        </Box>
    );
};

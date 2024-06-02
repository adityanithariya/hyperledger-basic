/*
 * Copyright IBM Corp. All Rights Reserved.
 *
 * SPDX-License-Identifier: Apache-2.0
 */
import { Gateway, GatewayOptions } from 'fabric-network';
import * as path from 'path';
import { buildCCPOrg1, buildWallet, prettyJSONString } from './utils/AppUtil';
import { buildCAClient, enrollAdmin, registerAndEnrollUser } from './utils/CAUtil';

const channelName = process.env.CHANNEL_NAME || 'mychannel';
const chaincodeName = process.env.CHAINCODE_NAME || 'basic';

const mspOrg1 = 'Org1MSP';
const walletPath = path.join(__dirname, '..', 'wallet');
const org1UserId = 'typescriptAppUser';

// pre-requisites:
// - fabric-sample two organization test-network setup with two peers, ordering service,
//   and 2 certificate authorities
//         ===> from directory /fabric-samples/test-network
//         ./network.sh up createChannel -ca
// - Use any of the asset-transfer-basic chaincodes deployed on the channel "mychannel"
//   with the chaincode name of "basic". The following deploy command will package,
//   install, approve, and commit the javascript chaincode, all the actions it takes
//   to deploy a chaincode to a channel.
//         ===> from directory /fabric-samples/test-network
//         ./network.sh deployCC -ccn basic -ccp ../asset-transfer-basic/chaincode-typescript/ -ccl javascript
// - Be sure that node.js is installed
//         ===> from directory /fabric-samples/asset-transfer-basic/application-typescript
//         node -v
// - npm installed code dependencies
//         ===> from directory /fabric-samples/asset-transfer-basic/application-typescript
//         npm install
// - to run this test application
//         ===> from directory /fabric-samples/asset-transfer-basic/application-typescript
//         npm start

// NOTE: If you see  kind an error like these:
/*
    2020-08-07T20:23:17.590Z - error: [DiscoveryService]: send[mychannel] - Channel:mychannel received discovery error:access denied
    ******** FAILED to run the application: Error: DiscoveryService: mychannel error: access denied

   OR

   Failed to register user : Error: fabric-ca request register failed with errors [[ { code: 20, message: 'Authentication failure' } ]]
   ******** FAILED to run the application: Error: Identity not found in wallet: appUser
*/
// Delete the /fabric-samples/asset-transfer-basic/application-typescript/wallet directory
// and retry this application.

// The certificate authority must have been restarted and the saved certificates for the
// admin and application user are not valid. Deleting the wallet store will force these to be reset
// with the new certificate authority.

/**
 *  A test application to show basic queries operations with any of the asset-transfer-basic chaincodes
 *   -- How to submit a transaction
 *   -- How to query and check the results
 *
 * To see the SDK workings, try setting the logging to show on the console before running
 *        export HFC_LOGGING='{"debug":"console"}'
 */
async function main() {
    try {
        const ccp = buildCCPOrg1();
        const caClient = buildCAClient(ccp, 'ca.org1.example.com');
        const wallet = await buildWallet(walletPath);
        await enrollAdmin(caClient, wallet, mspOrg1);
        await registerAndEnrollUser(caClient, wallet, mspOrg1, org1UserId, 'org1.department1');
        const gateway = new Gateway();

        const gatewayOpts: GatewayOptions = {
            wallet,
            identity: org1UserId,
            discovery: { enabled: true, asLocalhost: true }, // using asLocalhost as this gateway is using a fabric network deployed locally
        };

        try {
            await gateway.connect(ccp, gatewayOpts);
            const network = await gateway.getNetwork(channelName);
            const contract = network.getContract(chaincodeName);
            let result;

            console.log('\n--> Submit Transaction: InitLedger, function creates the initial set of assets on the ledger');
            await contract.submitTransaction('InitLedger');
            console.log('*** Result: committed');

            console.log('\n--> Evaluate Transaction: GetAllAssets, function returns all the current assets on the ledger');
            result = await contract.evaluateTransaction('GetAllAssets');
            console.log(`*** Result: ${prettyJSONString(result.toString())}`);

            console.log('\n--> Submit Transaction: CreateAsset, creates new asset with ID, color, owner, size, and appraisedValue arguments');
            await contract.submitTransaction('CreateAsset', 'asset413', 'yellow', '5', 'Tom', '1300');
            console.log('*** Result: committed');

            console.log('\n--> Evaluate Transaction: ReadAsset, function returns an asset with a given assetID');
            result = await contract.evaluateTransaction('ReadAsset', 'asset413');
            console.log(`*** Result: ${prettyJSONString(result.toString())}`);

            console.log('\n--> Evaluate Transaction: AssetExists, function returns "true" if an asset with given assetID exist');
            result = await contract.evaluateTransaction('AssetExists', 'asset1');
            console.log(`*** Result: ${prettyJSONString(result.toString())}`);

            console.log('\n--> Submit Transaction: UpdateAsset asset1, change the appraisedValue to 350');
            await contract.submitTransaction('UpdateAsset', 'asset1', 'blue', '5', 'Tomoko', '350');
            console.log('*** Result: committed');

            console.log('\n--> Evaluate Transaction: ReadAsset, function returns "asset1" attributes');
            result = await contract.evaluateTransaction('ReadAsset', 'asset1');
            console.log(`*** Result: ${prettyJSONString(result.toString())}`);

            console.log('\n--> Evaluate Transaction: GetHistory, function returns "asset1" history');
            result = await contract.evaluateTransaction('GetHistory', 'asset1');
            console.log(`*** Result: ${prettyJSONString(result.toString())}`);

            console.log('\n--> Evaluate Transaction: GetByNonPrimaryKey, function returns assets with "Size == 10"');
            try {
                result = await contract.evaluateTransaction('GetByNonPrimaryKey', JSON.stringify({
                    selector: {
                        Size: {
                            "$eq": 10
                        }
                    }
                }));
                console.log(`*** Result: ${prettyJSONString(result.toString())}`);
            } catch (error) {
                console.error(`*** GetByNonPrimaryKey ${error}`);
            }

            try {
                // How about we try a transactions where the executing chaincode throws an error
                // Notice how the submitTransaction will throw an error containing the error thrown by the chaincode
                console.log('\n--> Submit Transaction: UpdateAsset asset70, asset70 does not exist and should return an error');
                await contract.submitTransaction('UpdateAsset', 'asset70', 'blue', '5', 'Tomoko', '300');
                console.log('******** FAILED to return an error');
            } catch (error) {
                console.log(`*** Successfully caught the error: \n    ${error}`);
            }

            console.log('\n--> Submit Transaction: TransferAsset asset1, transfer to new owner of Tom');
            await contract.submitTransaction('TransferAsset', 'asset1', 'Tom');
            console.log('*** Result: committed');

            console.log('\n--> Evaluate Transaction: ReadAsset, function returns "asset1" attributes');
            result = await contract.evaluateTransaction('ReadAsset', 'asset1');
            console.log(`*** Result: ${prettyJSONString(result.toString())}`);
        } finally {
            // Disconnect from the gateway when the application is closing
            // This will close all connections to the network
            gateway.disconnect();
        }
    } catch (error) {
        console.error(`******** FAILED to run the application: ${error}`);
        process.exit(1);
    }
}

main();
